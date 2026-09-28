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
 * - 前段の nginx キャッシュは /feed/ とカテゴリRSSで別エントリのため、新しい ETag と古い items が組になりうる。
 *   /feed/ の記事と items の id・タイトル・日時が 1 件でも合わなければ ETag / Last-Modified を保存せず、次回は全量取得で直す。
 * - 304 判定はサイト側の変更しか見ないため、scripts の変更（push）や手動実行では forceRefresh で条件ヘッダーを付けずに取得する。
 */

import { isDeepStrictEqual } from "node:util";
import { logger } from "./logger.js";
import {
  fetchFeedConditional,
  fetchNewsCategoryFeedItems,
  NEWS_FEED_URL,
  parseNewsFeedItems,
  type FeedValidators,
  type NewsFeedItem,
} from "./news-feed.js";
import {
  hasPlaceholderNewsThumbnail,
  preserveStableNewsMedia,
  selectNewsPosts,
} from "./news-selection.js";
import { selectNewsThumbnail } from "./news-thumbnail.js";
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
  "id", "date", "title", "link", "categories", "content", "featured_media",
  // WordPress は _fields と _embed を併用するとき、_links を含めないと _embedded を返さない。
  "_links", "_embedded",
];

type NewsPostSummary = Pick<WPPost, "id" | "date" | "title" | "link" | "categories">;
type NewsPostDetail = Pick<WPPost, "id" | "content" | "_embedded">;

export interface NewsSyncDeps {
  /** 前回の news.json */
  previous: NewsData;
  /** 新しい news.json を書き出す */
  write: (data: NewsData) => void;
  now?: () => Date;
  /** true なら前回の ETag / Last-Modified を使わずに取得する */
  forceRefresh?: boolean;
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

/** リニューアル前後の同名「お知らせ」カテゴリを統合し、除外する「試合」カテゴリと合わせて返す。 */
async function resolveNewsCategoryIds(): Promise<{
  newsCategoryIds: number[];
  matchCategoryId: number | null;
}> {
  const categories = await getCategories();
  const newsCategories = selectNewsCategories(categories);
  if (newsCategories.length === 0) throw new Error("お知らせカテゴリが見つかりませんでした");
  logger.info(
    `お知らせカテゴリ: ${newsCategories.map((c) => `id=${c.id} count=${c.count}`).join(", ")}`,
  );
  return {
    newsCategoryIds: newsCategories.map((category) => category.id),
    matchCategoryId: categories.find((c) => c.name === "試合")?.id ?? null,
  };
}

/** 軽い一覧を取り、配信対象の投稿を新しい順に NEWS_LIMIT 件選ぶ。 */
async function fetchSelectedNewsPosts(): Promise<NewsPostSummary[]> {
  const { newsCategoryIds, matchCategoryId } = await resolveNewsCategoryIds();
  const posts = await getPosts<NewsPostSummary>({
    categories: newsCategoryIds,
    perPage: LIST_PER_PAGE,
    fields: LIST_FIELDS,
  });
  if (posts.length === 0) throw new Error("お知らせ投稿が0件でした");
  return selectNewsPosts(posts, newsCategoryIds, matchCategoryId, NEWS_LIMIT);
}

/** 指定した ID の本文とアイキャッチを 1 回の include 要求で取る。 */
async function fetchNewsPostDetails(ids: number[]): Promise<Map<number, NewsPostDetail>> {
  const detailById = new Map<number, NewsPostDetail>();
  if (ids.length === 0) return detailById;
  const details = await getPosts<NewsPostDetail>({
    include: ids,
    perPage: ids.length,
    embed: ["wp:featuredmedia"],
    fields: DETAIL_FIELDS,
  });
  for (const detail of details) detailById.set(detail.id, detail);
  return detailById;
}

/**
 * 詳細があればそこから、無ければ前回の画像を使う。
 * どちらも無い（詳細が返らなかった新規 ID）ときは null を返し、呼び出し側で除外する。
 */
function resolveNewsThumbnail(
  detail: NewsPostDetail | undefined,
  known: NewsItem | undefined,
): { thumbnailUrl: string | null } | null {
  if (detail) {
    return {
      thumbnailUrl: selectNewsThumbnail(
        detail._embedded?.["wp:featuredmedia"]?.[0],
        detail.content.rendered,
      ),
    };
  }
  if (known) return { thumbnailUrl: known.thumbnailUrl };
  return null;
}

async function fetchRestNewsItems(previousById: Map<number, NewsItem>): Promise<NewsItem[]> {
  const selected = await fetchSelectedNewsPosts();

  const selectedIds = selected.map((post) => post.id);
  const newIds = selectedIds.filter((id) => !previousById.has(id));
  const placeholderThumbnailIds = selectedIds.filter((id) => {
    const known = previousById.get(id);
    return known != null && hasPlaceholderNewsThumbnail(known);
  });
  const detailById = await fetchNewsPostDetails([...newIds, ...placeholderThumbnailIds]);
  logger.info(
    `REST: 一覧${selected.length}件のうち新規${newIds.length}件・`
      + `画像がクラブマークか未設定${placeholderThumbnailIds.length}件の詳細を要求し${detailById.size}件取得`,
  );

  const items: NewsItem[] = [];
  for (const post of selected) {
    const thumbnail = resolveNewsThumbnail(detailById.get(post.id), previousById.get(post.id));
    if (!thumbnail) {
      logger.warn(`REST: 詳細を取得できなかった投稿を除外します: id=${post.id}`);
      continue;
    }
    items.push({
      id: post.id,
      title: decodeEntities(post.title.rendered).trim(),
      date: post.date,
      url: post.link,
      thumbnailUrl: thumbnail.thumbnailUrl,
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

/** 標準RSSの記事のうち、items に同じ id・タイトル・日時で載っていないものを返す。 */
function findInconsistentFeedItems(feedItems: NewsFeedItem[], items: NewsItem[]): NewsFeedItem[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return feedItems.filter((feedItem) => {
    const item = itemById.get(feedItem.id);
    return !item
      || item.title !== decodeEntities(feedItem.title).trim()
      || item.date !== feedDateToWordPressLocal(feedItem.publishedAt);
  });
}

function presence(value: string | null): string {
  return value ? "あり" : "なし";
}

export async function syncNews(deps: NewsSyncDeps): Promise<NewsSyncResult> {
  const { previous } = deps;
  const previousById = new Map(previous.items.map((item) => [item.id, item]));

  // 前回の items が無いと 304 では何も作れないため、そのときは条件を付けずに取得する。
  const validators: FeedValidators = previous.items.length > 0 && !deps.forceRefresh
    ? { etag: previous.source?.feedEtag, lastModified: previous.source?.feedLastModified }
    : {};
  if (deps.forceRefresh) logger.info("強制再取得のため条件ヘッダーを付けずに標準RSSを取得します");
  const sentConditional = Boolean(validators.etag || validators.lastModified);
  const feed = await fetchFeedConditional(NEWS_FEED_URL, validators);
  if (feed.status === 304) {
    logger.info("標準RSSは前回から変更なし（304）のため news.json を更新しません");
    return "not-modified";
  }
  logger.info(
    `標準RSSを取得（200）: 条件ヘッダー${sentConditional ? "送信" : "なし"}・`
      + `ETag${presence(feed.etag)}・Last-Modified${presence(feed.lastModified)}`,
  );
  if (!feed.etag && !feed.lastModified) {
    logger.warn("標準RSSが ETag も Last-Modified も返さないため、次回も全量取得になります");
  }

  const feedItems = parseNewsFeedItems(feed.xml);
  const latestFeedItem = feedItems[0];
  if (!latestFeedItem) throw new Error("標準RSSに配信対象のお知らせ記事がありません");

  const fresh = await fetchFreshNewsItems(previousById);
  logger.info(`取得経路: ${fresh.route}`);

  if (!fresh.items.some((item) => item.id === latestFeedItem.id)) {
    throw new Error(
      `RSS最新記事が生成対象にありません（id=${latestFeedItem.id} ${latestFeedItem.title}）。更新を停止します`,
    );
  }
  logger.info(`RSS最新記事との整合を確認: id=${latestFeedItem.id} ${latestFeedItem.title}`);

  const inconsistent = findInconsistentFeedItems(feedItems, fresh.items);
  if (inconsistent.length > 0) {
    logger.warn(
      `標準RSSと生成対象で内容が合わない記事があるため、ETag / Last-Modified を保存せず次回は全量取得します: `
        + inconsistent.map((item) => `id=${item.id}`).join(", "),
    );
  }

  const items = fresh.items.map((item) => preserveStableNewsMedia(item, previousById.get(item.id)));

  const minimumSafeCount = Math.ceil(previous.items.length * 0.5);
  if (previous.items.length >= 10 && items.length < minimumSafeCount) {
    throw new Error(
      `お知らせ件数が急減したため更新を停止します（${previous.items.length}件→${items.length}件）`,
    );
  }

  const source: NewsSource = inconsistent.length > 0
    ? { feedEtag: null, feedLastModified: null, route: fresh.route }
    : { feedEtag: feed.etag, feedLastModified: feed.lastModified, route: fresh.route };
  const itemsChanged = !isDeepStrictEqual(items, previous.items);
  if (!itemsChanged && isDeepStrictEqual(source, previous.source)) {
    logger.info(`お知らせ・取得元とも前回と同じため news.json を更新しません（${items.length}件）`);
    return "unchanged";
  }

  const previousRoute = previous.source?.route;
  if (previousRoute && previousRoute !== source.route) {
    logger.info(`取得経路が ${previousRoute}→${source.route} に変わりました`);
  }
  deps.write({
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    source,
    items,
  });
  logger.info(
    itemsChanged
      ? `記事に変更ありのため書き出しました: お知らせ ${items.length}件`
      : `記事は前回と同じで、取得元（ETag / Last-Modified / 経路）だけ更新しました: お知らせ ${items.length}件`,
  );
  return "written";
}
