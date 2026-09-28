import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { syncNews } from "../src/lib/news-sync.js";
import { ANCLAS_MARK_URL } from "../src/lib/news-thumbnail.js";
import type { NewsData } from "../src/lib/types.js";
import { resetWpApiBlockedState } from "../src/lib/wordpress-client.js";

const NOTICE_CATEGORY_ID = 21;
const MATCH_CATEGORY_ID = 3;
/** 一覧に並ぶ投稿ID（新しい順）。先頭の121が今回の新着 */
const LIST_IDS = Array.from({ length: 21 }, (_, i) => 121 - i);

function wpDate(id: number): string {
  // IDが大きいほど新しい。REST APIと同じJSTローカル表記。
  const day = String(id - 100).padStart(2, "0");
  return `2026-08-${day}T10:00:00`;
}

function rssItem(id: number): string {
  const date = new Date(`${wpDate(id)}+09:00`).toUTCString();
  return `<item>
    <title><![CDATA[お知らせ ${id}]]></title>
    <link>https://anclas.jp/news/post-${id}/</link>
    <pubDate>${date}</pubDate>
    <guid isPermaLink="false">https://anclas.jp/?p=${id}</guid>
    <category><![CDATA[お知らせ]]></category>
    <content:encoded><![CDATA[<p><img src="https://anclas.jp/rss-${id}.jpg"></p>]]></content:encoded>
  </item>`;
}

function rss(ids: number[]): string {
  return `<rss><channel>${ids.map(rssItem).join("\n")}</channel></rss>`;
}

function listPost(id: number) {
  return {
    id,
    date: wpDate(id),
    title: { rendered: `お知らせ ${id}` },
    link: `https://anclas.jp/news/post-${id}/`,
    categories: [NOTICE_CATEGORY_ID],
  };
}

/** REST経路で既知IDから作られるのと同じ形の前回データ */
function previousData(ids: number[], source?: NewsData["source"]): NewsData {
  return {
    generatedAt: "2026-09-01T00:00:00.000Z",
    ...(source ? { source } : {}),
    items: ids.map((id) => ({
      id,
      title: `お知らせ ${id}`,
      date: wpDate(id),
      url: `https://anclas.jp/news/post-${id}/`,
      thumbnailUrl: `https://anclas.jp/prev-${id}.jpg`,
    })),
  };
}

interface FakeSiteOptions {
  etag?: string;
  lastModified?: string;
  /** false なら条件ヘッダーが一致しても 200 を返す */
  honorConditional?: boolean;
  /** REST API の応答ステータス */
  restStatus?: number;
  /** 標準RSSに載せる投稿ID */
  feedIds?: number[];
  /** include 要求で返さない投稿ID（非公開化など） */
  hiddenIds?: number[];
}

interface Call {
  url: URL;
  headers: Record<string, string>;
}

/** fetch を差し替え、標準RSS・REST API・カテゴリRSSをURLで出し分ける。 */
function stubSite(t: TestContext, options: FakeSiteOptions = {}): Call[] {
  const etag = options.etag ?? "\"etag-1\"";
  const lastModified = options.lastModified ?? "Mon, 28 Sep 2026 05:05:26 GMT";
  const feedIds = options.feedIds ?? LIST_IDS.slice(0, 10);
  const hidden = new Set(options.hiddenIds ?? []);
  const original = globalThis.fetch;
  const calls: Call[] = [];
  // 遮断フラグはモジュール単位で持つため、テストごとに戻す。
  resetWpApiBlockedState();
  t.after(() => { globalThis.fetch = original; });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = { ...(init?.headers as Record<string, string> | undefined) };
    calls.push({ url, headers });

    if (url.pathname === "/feed/") {
      const matched = headers["If-None-Match"] === etag;
      if (matched && options.honorConditional !== false) return new Response(null, { status: 304 });
      return new Response(rss(feedIds), {
        status: 200,
        headers: { ETag: etag, "Last-Modified": lastModified },
      });
    }
    if (url.pathname.startsWith("/wp-json/")) {
      if ((options.restStatus ?? 200) !== 200) {
        return new Response("Forbidden", { status: options.restStatus, statusText: "Forbidden" });
      }
      if (url.pathname.endsWith("/categories")) {
        return Response.json([
          { id: NOTICE_CATEGORY_ID, name: "お知らせ", slug: "notice", count: 30 },
          { id: MATCH_CATEGORY_ID, name: "試合", slug: "match", count: 10 },
        ]);
      }
      const include = url.searchParams.get("include");
      if (include) {
        return Response.json(include.split(",").map(Number).filter((id) => !hidden.has(id)).map((id) => ({
          id,
          content: { rendered: `<p><img src="https://anclas.jp/content-${id}.jpg"></p>` },
          _embedded: {
            "wp:featuredmedia": [{
              source_url: `https://anclas.jp/full-${id}.jpg`,
              media_details: { sizes: { medium: { source_url: `https://anclas.jp/medium-${id}.jpg`, width: 300, height: 200 } } },
            }],
          },
        })));
      }
      return Response.json(LIST_IDS.map(listPost));
    }
    if (url.searchParams.get("feed") === "rss2") {
      return new Response(url.searchParams.get("paged") === "1" ? rss(LIST_IDS.slice(0, 20)) : rss([]), { status: 200 });
    }
    throw new Error(`想定外の要求: ${url}`);
  }) as typeof fetch;
  return calls;
}

function capture(): { written: NewsData[]; write: (data: NewsData) => void } {
  const written: NewsData[] = [];
  return { written, write: (data) => { written.push(data); } };
}

const NOW = () => new Date("2026-09-29T00:00:00.000Z");

test("syncNews: 標準RSSが304なら書かず、標準RSS以外へ要求しない", async (t) => {
  const calls = stubSite(t);
  const out = capture();
  const previous = previousData(LIST_IDS.slice(1, 21), {
    feedEtag: "\"etag-1\"",
    feedLastModified: "Mon, 28 Sep 2026 05:05:26 GMT",
    route: "rss",
  });

  assert.equal(await syncNews({ previous, write: out.write, now: NOW }), "not-modified");
  assert.equal(out.written.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.pathname, "/feed/");
  assert.equal(calls[0]!.headers["If-None-Match"], "\"etag-1\"");
  assert.equal(calls[0]!.headers["If-Modified-Since"], "Mon, 28 Sep 2026 05:05:26 GMT");
});

test("syncNews: 前回にsourceが無ければ条件ヘッダー無しで取得し、sourceを付けて書く", async (t) => {
  const calls = stubSite(t, { feedIds: [121, 120] });
  const out = capture();

  const result = await syncNews({ previous: previousData(LIST_IDS.slice(1, 21)), write: out.write, now: NOW });

  assert.equal(result, "written");
  const feedCall = calls.find((call) => call.url.pathname === "/feed/")!;
  assert.equal(feedCall.headers["If-None-Match"], undefined);
  assert.equal(feedCall.headers["If-Modified-Since"], undefined);
  assert.equal(calls.filter((call) => call.url.pathname === "/feed/").length, 1, "標準RSSは1回だけ取得する");
  assert.deepEqual(out.written[0]!.source, {
    feedEtag: "\"etag-1\"",
    feedLastModified: "Mon, 28 Sep 2026 05:05:26 GMT",
    route: "rest",
  });
  assert.equal(out.written[0]!.generatedAt, "2026-09-29T00:00:00.000Z");
  assert.deepEqual(Object.keys(out.written[0]!), ["generatedAt", "source", "items"]);
});

test("syncNews: REST経路は既知IDの詳細を取らず、新規IDだけをincludeで1回取得する", async (t) => {
  const calls = stubSite(t, { feedIds: [121, 120] });
  const out = capture();

  await syncNews({ previous: previousData(LIST_IDS.slice(1, 21)), write: out.write, now: NOW });

  const postCalls = calls.filter((call) => call.url.pathname.endsWith("/posts"));
  assert.equal(postCalls.length, 2, "一覧と新規分の詳細の2回");
  const [list, detail] = postCalls;
  assert.equal(list!.url.searchParams.get("_fields"), "id,date,title,link,categories");
  assert.equal(list!.url.searchParams.get("_embed"), null);
  assert.equal(detail!.url.searchParams.get("include"), "121");
  assert.equal(detail!.url.searchParams.get("per_page"), "1");
  assert.equal(detail!.url.searchParams.get("_embed"), "wp:featuredmedia");
  const fields = detail!.url.searchParams.get("_fields")!.split(",");
  assert.ok(fields.includes("_links") && fields.includes("_embedded"), "_embedded を落とさない");

  const items = out.written[0]!.items;
  assert.equal(items.length, 20);
  assert.equal(items[0]!.id, 121);
  assert.equal(items[0]!.thumbnailUrl, "https://anclas.jp/medium-121.jpg");
  assert.equal(items[1]!.thumbnailUrl, "https://anclas.jp/prev-120.jpg", "既知IDは前回の画像を使う");
});

test("syncNews: 前回がクラブマークかnullの既知IDは詳細を取り、実画像へ改善する", async (t) => {
  // 112 は詳細が返らない。既知IDなので除外せず前回の画像を使う。
  const calls = stubSite(t, { hiddenIds: [112] });
  const out = capture();
  const previous = previousData(LIST_IDS.slice(0, 20));
  for (const item of previous.items) {
    if (item.id === 110 || item.id === 112) item.thumbnailUrl = ANCLAS_MARK_URL;
    if (item.id === 111) item.thumbnailUrl = null;
  }

  await syncNews({ previous, write: out.write, now: NOW });

  const detailCalls = calls.filter((call) => call.url.searchParams.has("include"));
  assert.equal(detailCalls.length, 1);
  assert.equal(detailCalls[0]!.url.searchParams.get("include"), "112,111,110");
  const byId = new Map(out.written[0]!.items.map((item) => [item.id, item]));
  assert.equal(byId.get(110)?.thumbnailUrl, "https://anclas.jp/medium-110.jpg");
  assert.equal(byId.get(111)?.thumbnailUrl, "https://anclas.jp/medium-111.jpg");
  assert.equal(byId.get(112)?.thumbnailUrl, ANCLAS_MARK_URL, "詳細が取れない既知IDは前回の画像のまま残す");
  assert.equal(byId.get(113)?.thumbnailUrl, "https://anclas.jp/prev-113.jpg", "実画像の既知IDは前回の画像を使う");
});

test("syncNews: 新規IDがなければ詳細要求を出さない", async (t) => {
  const calls = stubSite(t);
  const out = capture();

  await syncNews({ previous: previousData(LIST_IDS.slice(0, 20)), write: out.write, now: NOW });

  assert.equal(calls.filter((call) => call.url.searchParams.has("include")).length, 0);
});

test("syncNews: includeで返らなかった新規IDは捨て、次の候補で埋めない", async (t) => {
  stubSite(t, { feedIds: [120], hiddenIds: [121] });
  const out = capture();

  await syncNews({ previous: previousData(LIST_IDS.slice(1, 21)), write: out.write, now: NOW });

  const ids = out.written[0]!.items.map((item) => item.id);
  assert.equal(ids.length, 19);
  assert.ok(!ids.includes(121));
  assert.ok(!ids.includes(101), "21番目の候補で埋めない");
});

test("syncNews: REST APIが失敗したらカテゴリRSSへ切り替える", async (t) => {
  const calls = stubSite(t, { restStatus: 403, feedIds: [121] });
  const out = capture();

  assert.equal(
    await syncNews({ previous: previousData(LIST_IDS.slice(1, 21)), write: out.write, now: NOW }),
    "written",
  );
  assert.ok(calls.some((call) => call.url.searchParams.get("feed") === "rss2"), "カテゴリRSSを引く");
  const data = out.written[0]!;
  assert.equal(data.source?.route, "rss");
  assert.equal(data.items.length, 20);
  assert.equal(data.items[0]!.id, 121);
  assert.equal(data.items[0]!.thumbnailUrl, "https://anclas.jp/rss-121.jpg");
});

test("syncNews: itemsが同じでETagだけ変わったらsourceだけ更新して書く", async (t) => {
  stubSite(t, { etag: "\"etag-2\"" });
  const out = capture();
  const previous = previousData(LIST_IDS.slice(0, 20), {
    feedEtag: "\"etag-1\"",
    feedLastModified: "Mon, 28 Sep 2026 05:05:26 GMT",
    route: "rest",
  });

  assert.equal(await syncNews({ previous, write: out.write, now: NOW }), "written");
  const data = out.written[0]!;
  assert.deepEqual(data.items, previous.items);
  assert.equal(data.source?.feedEtag, "\"etag-2\"");
});

test("syncNews: itemsもETagも同じなら書かない", async (t) => {
  // 条件ヘッダーを無視して200を返すサーバーでも、差分が無ければ書かない。
  stubSite(t, { honorConditional: false });
  const out = capture();
  const previous = previousData(LIST_IDS.slice(0, 20), {
    feedEtag: "\"etag-1\"",
    feedLastModified: "Mon, 28 Sep 2026 05:05:26 GMT",
    route: "rest",
  });

  assert.equal(await syncNews({ previous, write: out.write, now: NOW }), "unchanged");
  assert.equal(out.written.length, 0);
});

test("syncNews: 前回のitemsが空なら条件ヘッダーを付けずに取得する", async (t) => {
  const calls = stubSite(t, { feedIds: [121] });
  const out = capture();
  const previous: NewsData = {
    generatedAt: "2026-09-01T00:00:00.000Z",
    source: { feedEtag: "\"etag-1\"", feedLastModified: null, route: "rest" },
    items: [],
  };

  assert.equal(await syncNews({ previous, write: out.write, now: NOW }), "written");
  assert.equal(calls[0]!.headers["If-None-Match"], undefined);
});
