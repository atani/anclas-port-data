import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  mergeSupplementalPlayers,
  parsePlayerBlogCards,
  parsePlayerPage,
  parsePlayerPageUrls,
  parsePlayerSeason,
  sortPlayers,
  toPlayerBlogEntries,
} from "../src/lib/player-parser.js";
import type { Player, PlayersData } from "../src/lib/types.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");
}

function playersJson(): PlayersData {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL("../../players.json", import.meta.url)), "utf-8"),
  ) as PlayersData;
}

const archiveHtml = fixture("player-archive.html");
const detailHtml = fixture("player-detail.html");
const blogHtml = fixture("player-blog-archive.html");
const detailUrl = "https://anclas.jp/player/shibusawa-hikaru/";

test("parsePlayerSeason: シーズン切替の選択中タブから年度を取る", () => {
  assert.equal(parsePlayerSeason(archiveHtml), "2026");
});

test("parsePlayerSeason: シーズン切替が無いページでは null を返す", () => {
  assert.equal(parsePlayerSeason("<main>選手一覧</main>"), null);
});

test("parsePlayerPageUrls: 一覧カードから個別ページURLを掲載順に取る", () => {
  const urls = parsePlayerPageUrls(archiveHtml);

  assert.equal(urls.length, 18);
  assert.equal(urls[0], detailUrl);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => url.startsWith("https://anclas.jp/player/")));
});

test("parsePlayerPageUrls: 同じ選手が重複掲載されても1件にまとめる", () => {
  const html = `
    <a class="c-player-card" href="https://anclas.jp/player/a/?ref=list">A</a>
    <a class="c-player-card" href="/player/b/">B</a>
    <a class="c-player-card" href="https://anclas.jp/player/a/#top">A</a>
  `;

  assert.deepEqual(parsePlayerPageUrls(html), [
    "https://anclas.jp/player/a/",
    "https://anclas.jp/player/b/",
  ]);
});

test("parsePlayerPage: 個別ページから背番号・氏名・プロフィールを取る", () => {
  const player = parsePlayerPage(detailHtml, detailUrl);

  assert.equal(player.id, 133);
  assert.equal(player.number, 3);
  assert.equal(player.nameJa, "澁澤光");
  assert.equal(player.nameEn, "SHIBUSAWA HIKARU");
  assert.equal(player.nickname, "ひか");
  assert.equal(player.sourceUrl, detailUrl);
  assert.equal(player.profile.birthdate, "2000年3月3日");
  assert.equal(player.profile.hometown, "埼玉県");
  assert.equal(player.profile.height, "168cm");
  assert.equal(player.profile.bloodType, "O 型");
  assert.match(player.profile.career ?? "", /^常盤木学園高等学校 – 東洋大学 –/);
});

test("parsePlayerPage: FAQ表を表示順のままパーソナル情報にする", () => {
  const personal = parsePlayerPage(detailHtml, detailUrl).personal;

  assert.equal(personal.length, 13);
  assert.deepEqual(personal[0], { label: "サッカー歴", value: "17 年" });
  assert.deepEqual(personal.at(-1), {
    label: "ファン・サポーターへ一言",
    value: "昇格しましょう！応援よろしくお願いします！",
  });
});

// 公式サイトが #3 の顔写真に別選手のファイル（tanabe.jpg）を出している。
// fixture はその状態をそのまま写したもので、解析の誤りではない。
test("parsePlayerPage: 顔写真は公開ページの1枚を4サイズすべてに入れる", () => {
  const photo = parsePlayerPage(detailHtml, detailUrl).photo;

  assert.deepEqual(
    new Set(Object.values(photo)),
    new Set(["https://anclas.jp/wp-content/uploads/2026/07/tanabe.jpg"]),
  );
});

test("parsePlayerPage: 関連選手スライダーやロゴの画像を顔写真に採用しない", () => {
  const html = `
    <body class="postid-999">
    <img src="https://anclas.jp/logo.png" alt="ロゴ">
    <div class="c-player-info">
      <h1 class="c-player-info__name">写真なし選手</h1>
    </div>
    <a class="c-player-card" href="https://anclas.jp/player/other/">
      <img class="c-player-card__image" src="https://anclas.jp/other.jpg" alt="別の選手">
      <h3 class="c-player-card__name">別の選手</h3>
    </a>
    </body>`;

  const player = parsePlayerPage(html, "https://anclas.jp/player/no-photo/");

  assert.equal(player.nameJa, "写真なし選手");
  assert.deepEqual(player.photo, {
    thumbnail: null,
    medium: null,
    large: null,
    full: null,
  });
});

test("parsePlayerPage: 投稿IDを取れないページは例外にする", () => {
  assert.throws(
    () => parsePlayerPage('<h1 class="c-player-info__name">澁澤光</h1>', detailUrl),
    /投稿IDを取得できませんでした/,
  );
});

test("parsePlayerPage: 氏名を取れないページは例外にする", () => {
  assert.throws(
    () => parsePlayerPage('<body class="postid-133"></body>', detailUrl),
    /氏名を取得できませんでした/,
  );
});

test("parsePlayerBlogCards: ブログ一覧カードからタイトル・URL・公開日を取る", () => {
  const cards = parsePlayerBlogCards(blogHtml);

  assert.equal(cards.length, 10);
  assert.deepEqual(cards[0], {
    title: "8月の思い出 #11嘉数クレア姫麗",
    url: "https://anclas.jp/player/blog/918/",
    date: "2026-09-18",
  });
});

test("parsePlayerBlogCards: 追加面の絵文字をそのまま復元する", () => {
  const titles = parsePlayerBlogCards(blogHtml).map((card) => card.title);

  assert.ok(titles.some((title) => title.includes("👴🎂🎉")), titles.join(" / "));
});

test("toPlayerBlogEntries: 背番号と選手名を紐付けキーにする", () => {
  const entries = toPlayerBlogEntries(parsePlayerBlogCards(blogHtml));

  assert.equal(entries.length, 10);
  assert.equal(entries[0]?.number, 11);
  assert.equal(entries[0]?.name, "嘉数クレア姫麗");
});

test("toPlayerBlogEntries: 背番号の無い記事は紐付け対象から外す", () => {
  const entries = toPlayerBlogEntries([
    { title: "選手ブログを始めました", url: "https://anclas.jp/player/blog/1/", date: "2026-01-01" },
    { title: "自己紹介 #7 杉浦華穂", url: "https://anclas.jp/player/blog/2/", date: "2026-01-02" },
  ]);

  assert.deepEqual(entries.map((entry) => entry.number), [7]);
});

test("sortPlayers: 背番号昇順・背番号なしは末尾", () => {
  const mk = (n: number | null, id: number): Player => ({
    id,
    number: n,
    position: null,
    nameJa: "x",
    nameEn: null,
    nickname: null,
    photo: { thumbnail: null, medium: null, large: null, full: null },
    profile: { birthdate: null, hometown: null, height: null, bloodType: null, career: null },
    personal: [],
    sourceUrl: "",
    blogPosts: [],
    sns: {},
    role: null,
  });
  const sorted = sortPlayers([mk(10, 1), mk(null, 2), mk(3, 3)]);
  assert.deepEqual(
    sorted.map((p) => p.number),
    [3, 10, null],
  );
});

test("mergeSupplementalPlayers: 公式ページにいない途中加入選手を背番号順で補完する", () => {
  const official = parsePlayerPage(detailHtml, detailUrl);
  const supplemental: Player = {
    ...official,
    id: 27930,
    number: 21,
    nameJa: "熊澤果歩",
    nameEn: "KUMAZAWA KAHO",
    sourceUrl: "https://anclas.jp/player/熊澤果歩/",
  };

  const result = mergeSupplementalPlayers([official], [supplemental]);

  assert.deepEqual(result.map((player) => player.number), [3, 21]);
  assert.equal(result.filter((player) => player.nameJa === "熊澤果歩").length, 1);
});

test("mergeSupplementalPlayers: 同名の公式プロフィールが取得できたら重複させない", () => {
  const official = { ...parsePlayerPage(detailHtml, detailUrl), nameJa: "熊澤果歩", number: 21 };
  const supplemental = { ...official, id: 27930, nickname: "補完値" };

  const result = mergeSupplementalPlayers([official], [supplemental]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, official.id);
  assert.notEqual(result[0]?.nickname, "補完値");
});

test("mergeSupplementalPlayers: 同名の公式プロフィールで欠けた項目だけ補完する", () => {
  const official = {
    ...parsePlayerPage(detailHtml, detailUrl),
    number: null,
    position: null,
    nameJa: "熊澤果歩",
    nickname: null,
    photo: { thumbnail: null, medium: null, large: null, full: null },
    personal: [],
  };
  const supplemental: Player = {
    ...official,
    id: 27930,
    number: 21,
    position: "GK",
    nickname: "くま",
    photo: { thumbnail: "thumb", medium: "medium", large: "large", full: "full" },
    personal: [{ label: "MBTI", value: "ESTP-A 起業家" }],
  };

  const result = mergeSupplementalPlayers([official], [supplemental]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, official.id);
  assert.equal(result[0]?.number, 21);
  assert.equal(result[0]?.position, "GK");
  assert.equal(result[0]?.nickname, "くま");
  assert.equal(result[0]?.photo.large, "large");
  assert.deepEqual(result[0]?.personal, supplemental.personal);
});

test("mergeSupplementalPlayers: 補完選手と同じ背番号の旧選手を置き換える", () => {
  const oldPlayer = { ...parsePlayerPage(detailHtml, detailUrl), number: 21, nameJa: "旧選手" };
  const supplemental = { ...oldPlayer, id: 27930, nameJa: "熊澤果歩" };

  const result = mergeSupplementalPlayers([oldPlayer], [supplemental]);

  assert.deepEqual(result.map((player) => player.nameJa), ["熊澤果歩"]);
});

test("players.json: 熊澤果歩を公式プロフィール情報付きで1件掲載する", () => {
  const players = playersJson().players.filter((player) => player.nameJa === "熊澤果歩");

  assert.equal(players.length, 1);
  assert.equal(players[0]?.number, 21);
  assert.equal(players[0]?.position, "GK");
  assert.equal(players[0]?.nickname, "くま");
  assert.equal(players[0]?.profile.bloodType, "A型");
  assert.equal(
    players[0]?.sourceUrl,
    "https://anclas.jp/player/%e7%86%8a%e6%be%a4%e6%9e%9c%e6%ad%a9/",
  );
  assert.equal(players[0]?.personal.length, 13);
});

test("players.json: 選手とブログの参照先を改装後の公開ページに揃える", () => {
  const data = playersJson();

  assert.ok(data.players.length >= 10);
  for (const player of data.players) {
    assert.match(player.sourceUrl, /^https:\/\/anclas\.jp\/player\//, player.nameJa);
    for (const post of player.blogPosts) {
      assert.match(post.url, /^https:\/\/anclas\.jp\/player\/blog\//, post.title);
    }
  }
});
