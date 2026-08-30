import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANCLAS_MARK_URL,
  extractFirstContentImage,
  selectNewsThumbnail,
} from "../src/lib/news-thumbnail.js";

test("selectNewsThumbnail: WordPressのアイキャッチを最優先する", () => {
  const media = {
    source_url: "https://anclas.jp/full.jpg",
    media_details: {
      sizes: {
        medium: { source_url: "https://anclas.jp/medium.jpg", width: 300, height: 200 },
      },
    },
  };

  assert.equal(
    selectNewsThumbnail(media, '<img src="https://anclas.jp/content.jpg">'),
    "https://anclas.jp/medium.jpg",
  );
});

test("extractFirstContentImage: 本文の最初の実画像を取得する", () => {
  const html = `
    <img src="data:image/gif;base64,AAA">
    <img data-src="/wp-content/uploads/2026/08/news.jpg" src="placeholder.gif">
  `;

  assert.equal(
    extractFirstContentImage(html),
    "https://anclas.jp/wp-content/uploads/2026/08/news.jpg",
  );
});

test("selectNewsThumbnail: 本文にも画像がなければアンクラスマークを使う", () => {
  assert.equal(selectNewsThumbnail(undefined, "<p>画像なしのお知らせ</p>"), ANCLAS_MARK_URL);
});
