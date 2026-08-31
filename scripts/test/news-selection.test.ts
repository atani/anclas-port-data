import assert from "node:assert/strict";
import { test } from "node:test";
import { ANCLAS_MARK_URL } from "../src/lib/news-thumbnail.js";
import { preserveStableNewsMedia, selectNewsPosts } from "../src/lib/news-selection.js";
import type { NewsItem } from "../src/lib/types.js";
import type { WPPost } from "../src/lib/wordpress-client.js";

function post(id: number, date: string, categories: number[]): WPPost {
  return {
    id,
    date,
    categories,
    title: { rendered: `post ${id}` },
    content: { rendered: "" },
    excerpt: { rendered: "" },
    link: `https://anclas.jp/post-${id}/`,
    tags: [],
    featured_media: 0,
  };
}

test("selectNewsPosts: 新旧お知らせを統合し、ALL NEWS必須・試合除外で新しい順にする", () => {
  const posts = [
    post(1, "2026-08-31T10:00:00", [1]),
    post(2, "2026-08-30T10:00:00", [21, 6, 3]),
    post(3, "2026-08-29T10:00:00", [21, 6]),
    post(4, "2026-08-31T11:00:00", [1, 6]),
  ];

  assert.deepEqual(
    selectNewsPosts(posts, [21, 1], 6, 3, 20).map((selected) => selected.id),
    [4, 3],
  );
});

test("preserveStableNewsMedia: 既存記事の移行URLと画像URLの一斉変更を抑える", () => {
  const previous: NewsItem = {
    id: 3,
    title: "以前のタイトル",
    date: "2026-08-29T10:00:00",
    url: "https://anclas.jp/post-3/",
    thumbnailUrl: "https://anclas.jp/old.jpg",
  };
  const fresh: NewsItem = {
    ...previous,
    title: "訂正後のタイトル",
    url: "https://anclas.jp/news/2026/08/29/post-3/",
    thumbnailUrl: "https://anclas.jp/new.jpg",
  };

  assert.deepEqual(preserveStableNewsMedia(fresh, previous), {
    ...fresh,
    url: previous.url,
    thumbnailUrl: previous.thumbnailUrl,
  });
});

test("preserveStableNewsMedia: クラブマークから実画像への改善は反映する", () => {
  const previous: NewsItem = {
    id: 3,
    title: "記事",
    date: "2026-08-29T10:00:00",
    url: "https://anclas.jp/post-3/",
    thumbnailUrl: ANCLAS_MARK_URL,
  };
  const fresh = { ...previous, thumbnailUrl: "https://anclas.jp/real.jpg" };

  assert.equal(preserveStableNewsMedia(fresh, previous).thumbnailUrl, fresh.thumbnailUrl);
});
