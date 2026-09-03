import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseLatestNewsFeedItem, parseNewsFeedItems } from "../src/lib/news-feed.js";
import type { NewsData } from "../src/lib/types.js";

function item(id: number, title: string, categories: string[]): string {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <link>https://anclas.jp/news/post-${id}/</link>
    <pubDate>Mon, 31 Aug 2026 09:07:00 +0000</pubDate>
    <guid isPermaLink="false">https://anclas.jp/?p=${id}</guid>
    ${categories.map((category) => `<category><![CDATA[${category}]]></category>`).join("\n")}
    <content:encoded><![CDATA[<p><img src="https://anclas.jp/image-${id}.jpg"></p>]]></content:encoded>
  </item>`;
}

test("parseLatestNewsFeedItem: お知らせカテゴリの最新記事を取得する", () => {
  const xml = `<rss><channel>${item(28663, "なでしこリーグ加盟審査を受けて", ["ALL NEWS", "お知らせ"])}</channel></rss>`;
  assert.deepEqual(parseLatestNewsFeedItem(xml), {
    id: 28663,
    title: "なでしこリーグ加盟審査を受けて",
    url: "https://anclas.jp/news/post-28663/",
    publishedAt: "Mon, 31 Aug 2026 09:07:00 +0000",
    categories: ["ALL NEWS", "お知らせ"],
    contentHtml: '<p><img src="https://anclas.jp/image-28663.jpg"></p>',
  });
});

test("parseNewsFeedItems: 複数ページ用に対象記事をすべて抽出する", () => {
  const xml = `<rss><channel>
    ${item(4, "新しい記事", ["ALL NEWS", "お知らせ"])}
    ${item(3, "通常の記事", ["ALL NEWS", "お知らせ"])}
    ${item(2, "試合記事", ["ALL NEWS", "お知らせ", "試合"])}
  </channel></rss>`;
  assert.deepEqual(parseNewsFeedItems(xml).map((entry) => entry.id), [4, 3]);
});

test("parseLatestNewsFeedItem: ALL NEWSがなくても正規のお知らせは採用する", () => {
  const xml = `<rss><channel>
    ${item(28787, "トップチーム体制変更のお知らせ", ["お知らせ"])}
    ${item(2, "試合結果", ["ALL NEWS", "お知らせ", "試合"])}
    ${item(3, "通常のお知らせ", ["ALL NEWS", "お知らせ"])}
  </channel></rss>`;
  assert.equal(parseLatestNewsFeedItem(xml)?.id, 28787);
});

test("parseLatestNewsFeedItem: WordPress初期投稿のHello worldは除外する", () => {
  const hello = item(1, "Hello world!", ["お知らせ"])
    .replace("https://anclas.jp/news/post-1/", "https://anclas.jp/news/2026/07/23/hello-world/");
  assert.equal(parseLatestNewsFeedItem(`<rss><channel>${hello}</channel></rss>`), null);
});

test("parseLatestNewsFeedItem: 対象記事がなければnullを返す", () => {
  assert.equal(parseLatestNewsFeedItem(`<rss><channel>${item(9, "選手ブログ", ["選手ブログ"])}</channel></rss>`), null);
});

test("news.json: トップチーム体制変更のお知らせを最新記事として掲載する", () => {
  const data = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../news.json", import.meta.url)), "utf-8"),
  ) as NewsData;
  const articles = data.items.filter((entry) => entry.id === 28787);

  assert.equal(articles.length, 1);
  assert.equal(data.items[0]?.id, 28787);
  assert.equal(articles[0]?.title, "トップチーム体制変更のお知らせ");
  assert.equal(
    articles[0]?.thumbnailUrl,
    "https://anclas.jp/wp-content/uploads/2026/08/名称未設定のデザイン-4.png",
  );
});
