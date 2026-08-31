import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLatestNewsFeedItem, parseNewsFeedItems } from "../src/lib/news-feed.js";

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

test("parseLatestNewsFeedItem: ALL NEWSとお知らせを持つ最新記事を取得する", () => {
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

test("parseLatestNewsFeedItem: ALL NEWSのない旧投稿と試合投稿を除外する", () => {
  const xml = `<rss><channel>
    ${item(1, "Hello world!", ["お知らせ"])}
    ${item(2, "試合結果", ["ALL NEWS", "お知らせ", "試合"])}
    ${item(3, "通常のお知らせ", ["ALL NEWS", "お知らせ"])}
  </channel></rss>`;
  assert.equal(parseLatestNewsFeedItem(xml)?.id, 3);
});

test("parseLatestNewsFeedItem: 対象記事がなければnullを返す", () => {
  assert.equal(parseLatestNewsFeedItem(`<rss><channel>${item(1, "Hello", ["お知らせ"])}</channel></rss>`), null);
});
