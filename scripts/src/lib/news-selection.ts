import type { WPPost } from "./wordpress-client.js";
import { ANCLAS_MARK_URL } from "./news-thumbnail.js";
import type { NewsItem } from "./types.js";

/** WordPress が初期生成するサンプル投稿はクラブのお知らせとして配信しない。 */
export function isWordPressSampleNews(id: number, url: string): boolean {
  try {
    return id === 1 && new URL(url).pathname.endsWith("/hello-world/");
  } catch {
    return false;
  }
}

export function selectNewsPosts<T extends Pick<WPPost, "id" | "date" | "link" | "categories">>(
  posts: T[],
  noticeCategoryIds: number[],
  matchCategoryId: number | null,
  limit: number,
): T[] {
  const noticeIds = new Set(noticeCategoryIds);
  const unique = new Map<number, T>();
  for (const post of posts) {
    if (!post.categories.some((id) => noticeIds.has(id))) continue;
    if (matchCategoryId != null && post.categories.includes(matchCategoryId)) continue;
    if (isWordPressSampleNews(post.id, post.link)) continue;
    unique.set(post.id, post);
  }
  return [...unique.values()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

/** 画像が未設定かクラブマークで、実画像への差し替え候補になる記事か。 */
export function hasPlaceholderNewsThumbnail(item: Pick<NewsItem, "thumbnailUrl">): boolean {
  return item.thumbnailUrl == null || item.thumbnailUrl === ANCLAS_MARK_URL;
}

/**
 * サイト移行で既存URL・画像URLだけが一斉変更されても、配信データを不要に揺らさない。
 * ただし以前クラブマークしか無かった記事に実画像が付いた場合は更新する。
 */
export function preserveStableNewsMedia(fresh: NewsItem, previous: NewsItem | undefined): NewsItem {
  if (!previous) return fresh;
  const canImproveThumbnail =
    hasPlaceholderNewsThumbnail(previous) && !hasPlaceholderNewsThumbnail(fresh);
  return {
    ...fresh,
    url: previous.url,
    thumbnailUrl: canImproveThumbnail ? fresh.thumbnailUrl : previous.thumbnailUrl,
  };
}
