/**
 * news.json の差分同期。
 *
 * 毎時の実行で変更の無い時間帯に通信しないための設計。
 * - 標準RSS（/feed/）を前回の ETag / Last-Modified 付きで取得し、304 なら何も書かずに終える。
 *   anclas.jp の ETag はサイト全体の最終更新を表すため、/feed/ の 1 回で「どこかが変わったか」が分かる。
 * - 200 のときは、その XML から最新記事を取り出して整合確認に使う（標準RSSを取り直さない）。
 * - REST 経路は「軽い一覧（_fields 指定）→ 前回に無い ID だけ include で詳細取得」にする。
 *   前回の画像が null かクラブマークの既知 ID も詳細を取り、実画像への改善を拾う。他の既知 ID は前回の thumbnailUrl を使う。
 *   include で返らなかった新規 ID（非公開化など）は捨て、
 *   次の候補で埋めない（件数の急減は既存のガードが止める）。
 * - RSS 経路（GitHub Actions では REST が 403）は従来どおりカテゴリRSSから全件を組み直す。
 *   304 で止まるため、組み直しはサイトが更新された時間帯だけになる。
 * - items と source がどちらも前回と同じなら書かない。ETag だけ変わった場合も、
 *   次回の 304 判定に必要なので source を更新して書く。
 */

import { isDeepStrictEqual } from "node:util";
import { logger } from "./logger.js";
import {
  fetchFeedConditional,
  fetchNewsCategoryFeedItems,
  NEWS_FEED_URL,
  parseLatestNewsFeedItem,
  type NewsFeedItem,
} from "./news-feed.js";
import { preserveStableNewsMedia, selectNewsPosts } from "./news-selection.js";
import { ANCLAS_MARK_URL, selectNewsThumbnail } from "./news-thumbnail.js";
import type { NewsData, NewsItem, NewsSource } from "./types.js";
import {
  getCategories,
  getPosts,
  selectNewsCategories,
  type WPPost,
} from "./wordpress-client.js";

const NEWS_LIMIT = 20;
const LIST_PER_PAGE = 50;
const LIST_FIELDS = ["id", "date", "title", "link", "categories"];
const DETAIL_FIELDS = [
  "id", "date", "title", "link", "categories", "content", "featured_media", "_links", "_embedded",
];

type NewsPostSummary = Pick<WPPost, "id" | "date" | "title" | "link" | "categories">;
type NewsPostDetail = Pick<WPPost, "id" | "content" | "_embedded">;

export interface NewsSyncDeps {
  /** 前回の news.json */
  previous: NewsData;
  /** 新しい news.json を書き出す */
  write: (data: NewsData) => void;
  now?: () => Date;
}

/** not-modified: 304 で終了 / unchanged: 取得したが差分なし / written: 書き出した */
export type NewsSyncResult = "not-modified" | "unchanged" | "written";

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&nbsp;/g, " ");
}

function feedDateToWordPressLocal(publishedAt: string): string {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) throw new Error(`RSSの公開日時が不正です: ${publishedAt}`);
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

function feedItemToNewsItem(item: NewsFeedItem): NewsItem {
  return {
    id: item.id,
    title: decodeEntities(item.title).trim(),
    date: feedDateToWordPressLocal(item.publishedAt),
    url: item.url,
    thumbnailUrl: selectNewsThumbnail(undefined, item.contentHtml),
  };
}

async function fetchRestNewsItems(previousById: Map<number, NewsItem>): Promise<NewsItem[]> {
  // リニューアル前後の同名「お知らせ」カテゴリを統合する。
  const categories = await getCategories();
  const newsCategories = selectNewsCategories(categories);
  if (newsCategories.length === 0) throw new Error("お知らせカテゴリが見つかりませんでした");
  logger.info(
    `お知らせカテゴリ: ${newsCategories.map((c) => `id=${c.id} count=${c.count}`).join(", ")}`,
  );
  const matchCategoryId = categories.find((c) => c.name === "試合")?.id;
  const newsCategoryIds = newsCategories.map((category) => category.id);
  const posts = await getPosts<NewsPostSummary>({
    categories: newsCategoryIds,
    perPage: LIST_PER_PAGE,
    fields: LIST_FIELDS,
  });
  if (posts.length === 0) throw new Error("お知らせ投稿が0件でした");
  const selected = selectNewsPosts(posts, newsCategoryIds, matchCategoryId ?? null, NEWS_LIMIT);

  const newIds = selected.map((post) => post.id).filter((id) => !previousById.has(id));
  const upgradeIds = selected.map((post) => post.id).filter((id) => {
    const thumbnailUrl = previousById.get(id)?.thumbnailUrl;
    return thumbnailUrl === null || thumbnailUrl === ANCLAS_MARK_URL;
  });
  const detailIds = [...newIds, ...upgradeIds];
  const detailById = new Map<number, NewsPostDetail>();
  if (detailIds.length > 0) {
    const details = await getPosts<NewsPostDetail>({
      include: detailIds,
      perPage: detailIds.length,
      embed: ["wp:featuredmedia"],
      fields: DETAIL_FIELDS,
    });
    for (const detail of details) detailById.set(detail.id, detail);
  }
  logger.info(
    `REST: 一覧${selected.length}件のうち新規${newIds.length}件・画像未設定${upgradeIds.length}件の詳細を取得`,
  );

  const items: NewsItem[] = [];
  for (const post of selected) {
    const known = previousById.get(post.id);
    const detail = detailById.get(post.id);
    let thumbnailUrl: string | null;
    if (detail) {
      thumbnailUrl = selectNewsThumbnail(
        detail._embedded?.["wp:featuredmedia"]?.[0],
        detail.content.rendered,
      );
    } else if (known) {
      thumbnailUrl = known.thumbnailUrl;
    } else {
      logger.warn(`REST: 詳細を取得できなかった投稿を除外します: id=${post.id}`);
      continue;
    }
    items.push({
      id: post.id,
      title: decodeEntities(post.title.rendered).trim(),
      date: post.date,
      url: post.link,
      thumbnailUrl,
    });
  }
  return items;
}

async function fetchFreshNewsItems(
  previousById: Map<number, NewsItem>,
): Promise<{ route: NewsSource["route"]; items: NewsItem[] }> {
  try {
    return { route: "rest", items: await fetchRestNewsItems(previousById) };
  } catch (error) {
    logger.warn(`WordPress REST APIからニュースを取得できないためカテゴリRSSを使用します: ${error}`);
    return {
      route: "rss",
      items: (await fetchNewsCategoryFeedItems(NEWS_LIMIT)).map(feedItemToNewsItem),
    };
  }
}

export async function syncNews(deps: NewsSyncDeps): Promise<NewsSyncResult> {
  const { previous } = deps;
  const previousById = new Map(previous.items.map((item) => [item.id, item]));

  // 前回の items が無いと 304 では何も作れないため、そのときは条件を付けずに取得する。
  const validators = previous.items.length > 0
    ? { etag: previous.source?.feedEtag, lastModified: previous.source?.feedLastModified }
    : {};
  const feed = await fetchFeedConditional(NEWS_FEED_URL, validators);
  if (feed.status === 304) {
    logger.info("標準RSSは前回から変更なし（304）のため news.json を更新しません");
    return "not-modified";
  }

  const latestFeedItem = parseLatestNewsFeedItem(feed.xml);
  if (!latestFeedItem) throw new Error("標準RSSに配信対象のお知らせ記事がありません");

  const fresh = await fetchFreshNewsItems(previousById);
  logger.info(`取得経路: ${fresh.route}`);

  if (!fresh.items.some((item) => item.id === latestFeedItem.id)) {
    throw new Error(
      `RSS最新記事が生成対象にありません（id=${latestFeedItem.id} ${latestFeedItem.title}）。更新を停止します`,
    );
  }
  logger.info(`RSS最新記事との整合を確認: id=${latestFeedItem.id} ${latestFeedItem.title}`);

  const items = fresh.items.map((item) => preserveStableNewsMedia(item, previousById.get(item.id)));

  const minimumSafeCount = Math.ceil(previous.items.length * 0.5);
  if (previous.items.length >= 10 && items.length < minimumSafeCount) {
    throw new Error(
      `お知らせ件数が急減したため更新を停止します（${previous.items.length}件→${items.length}件）`,
    );
  }

  const source: NewsSource = {
    feedEtag: feed.etag,
    feedLastModified: feed.lastModified,
    route: fresh.route,
  };
  if (isDeepStrictEqual(items, previous.items) && isDeepStrictEqual(source, previous.source)) {
    logger.info(`お知らせ・取得元とも前回と同じため news.json を更新しません（${items.length}件）`);
    return "unchanged";
  }

  deps.write({
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    source,
    items,
  });
  logger.info(`done: お知らせ ${items.length}件`);
  return "written";
}
