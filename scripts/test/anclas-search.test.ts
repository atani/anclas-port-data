import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseSearchFeedPosts,
  parseSearchResultCards,
  resetAnclasSearchCache,
  toWordPressLocalDate,
} from "../src/lib/anclas-search.js";
import { parseNewsFeedItems } from "../src/lib/news-feed.js";
import {
  findMatchPoster,
  findMatchReport,
  findRescheduleInfo,
  parseAnnouncementDateTime,
  parseAnnouncementVenue,
  resetWpApiBlockedState,
} from "../src/lib/wordpress-client.js";

const feedFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/anclas-search-feed.xml", import.meta.url)),
  "utf-8",
);
const cardsFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/anclas-search-cards.html", import.meta.url)),
  "utf-8",
);

test("toWordPressLocalDate: GMTのpubDateをREST APIと同じJST表記へ直す", () => {
  // GMT 9/20 23:00 は JST 9/21 08:00。日付だけを比べる箇所で1日ずれないことを確かめる。
  assert.equal(toWordPressLocalDate("Sun, 20 Sep 2026 23:00:00 +0000"), "2026-09-21T08:00:00");
  assert.equal(toWordPressLocalDate("Mon, 21 Sep 2026 11:16:46 +0000"), "2026-09-21T20:16:46");
  assert.equal(toWordPressLocalDate("解析できない日付"), null);
});

test("parseSearchFeedPosts: 検索RSSをREST APIと同じWPPostの形へ変換する", () => {
  const posts = parseSearchFeedPosts(feedFixture);
  assert.equal(posts.length, 2);

  const report = posts[0]!;
  assert.match(report.title.rendered, /^マッチレポート【/);
  assert.equal(report.link, "https://anclas.jp/news/2026/09/21/920/");
  assert.equal(report.date, "2026-09-21T08:00:00");
  assert.ok(report.id > 0);
  // content:encoded はCDATA内の生HTML。REST APIのcontent.renderedと同じく実体参照を残す。
  assert.match(report.content.rendered, /^<p>公式記録<\/p>/);
});

test("parseSearchFeedPosts: 「試合」カテゴリのマッチレポートも落とさない", () => {
  // ニュース用の parseNewsFeedItems は「試合」を除外するため、検索には転用できない。
  assert.equal(parseNewsFeedItems(feedFixture).length, 1);
  assert.equal(parseSearchFeedPosts(feedFixture).length, 2);
});

test("parseSearchResultCards: 記事カードからURL・タイトル・公開日・画像を取り出す", () => {
  const cards = parseSearchResultCards(cardsFixture);
  assert.equal(cards.length, 2);

  const poster = cards[0]!;
  assert.equal(poster.url, "https://anclas.jp/news/2026/09/02/0920/");
  assert.match(poster.title, /^【開催情報】/);
  assert.equal(poster.date, "2026-09-02");
  assert.equal(
    poster.imageUrl,
    "https://anclas.jp/wp-content/uploads/2026/09/0920_home_fukuoka_ig.webp",
  );

  // アイキャッチ未設定の投稿に出るサイト既定画像はポスターとして採用しない。
  assert.equal(cards[1]!.imageUrl, null);
});

/** fetch を fixture で差し替える。検索RSSと検索結果HTMLを引数のURLで出し分ける。 */
function stubFetch(): { calls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  // 遮断フラグと取得結果の使い回しはモジュール単位で持つため、テストごとに戻す。
  resetWpApiBlockedState();
  resetAnclasSearchCache();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/wp-json/")) {
      return new Response("You don't have permission to access this resource.", {
        status: 403,
        statusText: "Forbidden",
      });
    }
    const body = url.includes("feed=rss2") ? feedFixture : cardsFixture;
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("findMatchReport: WP APIが403でも検索RSSからレポートを組み立てる", async (t) => {
  const stub = stubFetch();
  t.after(stub.restore);

  const result = await findMatchReport("東海大学付属福岡高等学校", "2026-09-20");
  assert.ok(result, "マッチレポートを取得できること");
  assert.equal(result.report.sourceUrl, "https://anclas.jp/news/2026/09/21/920/");
  assert.equal(result.report.coachComment?.name, "佐藤太郎");
  assert.equal(result.reportedGoals.length, 1);
  assert.equal(result.reportedGoals[0]!.playerName, "山田花子");
  assert.deepEqual(result.photoGallery, [
    "https://anclas.jp/wp-content/uploads/2026/09/gallery-1.jpg",
  ]);
  assert.ok(stub.calls.some((url) => url.includes("feed=rss2")), "検索RSSを引くこと");
});

test("findMatchReport: 同一実行で403を繰り返し要求しない", async (t) => {
  const stub = stubFetch();
  t.after(stub.restore);

  await findMatchReport("東海大学付属福岡高等学校", "2026-09-20");
  await findMatchReport("東海大学付属福岡高等学校", "2026-09-20");
  const apiCalls = stub.calls.filter((url) => url.includes("/wp-json/"));
  assert.equal(apiCalls.length, 1, `WP APIへの要求は1回だけ: ${apiCalls.length}回`);
});

test("findRescheduleInfo: 検索RSSから代替試合情報の日程を取り出す", async (t) => {
  const stub = stubFetch();
  t.after(stub.restore);

  const info = await findRescheduleInfo("国見FCレディース", "2026-06-28");
  assert.ok(info, "代替日程を取得できること");
  assert.equal(info.date, "2026-07-12");
  assert.equal(info.kickoff, "16:00");
  assert.equal(info.venue, "福岡市雁ノ巣運動公園");
  assert.equal(info.sourceUrl, "https://anclas.jp/news/2026/07/05/post-27500/");
});

test("findMatchPoster: 検索結果HTMLのカードからアイキャッチを取り出す", async (t) => {
  const stub = stubFetch();
  t.after(stub.restore);

  // 告知カードのタイトルは対戦相手名の先頭4文字を含む必要がある。
  const poster = await findMatchPoster("東海大福岡高校", "2026-09-20");
  assert.equal(
    poster,
    "https://anclas.jp/wp-content/uploads/2026/09/0920_home_fukuoka_ig.webp",
  );
});

test("findMatchPoster: 試合日の30日より前の告知は採用しない", async (t) => {
  const stub = stubFetch();
  t.after(stub.restore);

  // カードの公開日は2026-09-02。試合日が11月なら対象期間から外れる。
  assert.equal(await findMatchPoster("東海大福岡高校", "2026-11-15"), null);
});

test("parseAnnouncementDateTime / Venue: RSS由来の告知本文でも従来どおり解釈する", () => {
  const text = "代替試合情報\n日　　時：2026年7月12日(日)16：00 キックオフ\n会　　場：福岡市雁ノ巣運動公園〈福岡市東区〉";
  assert.deepEqual(parseAnnouncementDateTime(text), { date: "2026-07-12", kickoff: "16:00" });
  assert.equal(parseAnnouncementVenue(text), "福岡市雁ノ巣運動公園");
});
