import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import {
  fetchLatestNewsFeedItem,
  fetchNewsCategoryFeedItems,
  type NewsFeedItem,
} from "./lib/news-feed.js";
import { preserveStableNewsMedia, selectNewsPosts } from "./lib/news-selection.js";
import { logger } from "./lib/logger.js";
import { selectNewsThumbnail } from "./lib/news-thumbnail.js";
import type { NewsData, NewsItem } from "./lib/types.js";
import {
  getCategories,
  getPosts,
  selectAllNewsCategory,
  selectNewsCategories,
} from "./lib/wordpress-client.js";

const DATA_DIR = new URL("../../", import.meta.url);
const NEWS_LIMIT = 20;

function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(new URL(name, DATA_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  logger.info(`wrote ${name}`);
}

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

async function fetchFreshNewsItems(): Promise<NewsItem[]> {
  try {
    // リニューアル前後の同名カテゴリを統合し、ALL NEWS との積集合を採用する。
    const categories = await getCategories();
    const newsCategories = selectNewsCategories(categories);
    if (newsCategories.length === 0) throw new Error("お知らせカテゴリが見つかりませんでした");
    const allNewsCategory = selectAllNewsCategory(categories);
    if (!allNewsCategory) throw new Error("ALL NEWSカテゴリが見つかりませんでした");
    logger.info(
      `お知らせカテゴリ: ${newsCategories.map((c) => `id=${c.id} count=${c.count}`).join(", ")}`,
    );
    logger.info(`ALL NEWSカテゴリ: id=${allNewsCategory.id} count=${allNewsCategory.count}`);

    const matchCategoryId = categories.find((c) => c.name === "試合")?.id;
    const posts = await getPosts({
      categories: newsCategories.map((category) => category.id),
      perPage: 100,
      embed: true,
    });
    if (posts.length === 0) throw new Error("お知らせ投稿が0件でした");
    return selectNewsPosts(
      posts,
      newsCategories.map((category) => category.id),
      allNewsCategory.id,
      matchCategoryId ?? null,
      NEWS_LIMIT,
    ).map((post) => {
      const media = post._embedded?.["wp:featuredmedia"]?.[0];
      return {
        id: post.id,
        title: decodeEntities(post.title.rendered).trim(),
        date: post.date,
        url: post.link,
        thumbnailUrl: selectNewsThumbnail(media, post.content.rendered),
      };
    });
  } catch (error) {
    logger.warn(`WordPress REST APIからニュースを取得できないためカテゴリRSSを使用します: ${error}`);
    return (await fetchNewsCategoryFeedItems(NEWS_LIMIT)).map(feedItemToNewsItem);
  }
}

async function main(): Promise<void> {
  const previous = JSON.parse(
    readFileSync(new URL("news.json", DATA_DIR), "utf-8"),
  ) as NewsData;
  const previousById = new Map(previous.items.map((item) => [item.id, item]));

  const freshItems = await fetchFreshNewsItems();

  const latestFeedItem = await fetchLatestNewsFeedItem();
  if (!freshItems.some((item) => item.id === latestFeedItem.id)) {
    throw new Error(
      `RSS最新記事が生成対象にありません（id=${latestFeedItem.id} ${latestFeedItem.title}）。更新を停止します`,
    );
  }
  logger.info(`RSS最新記事との整合を確認: id=${latestFeedItem.id} ${latestFeedItem.title}`);

  const items = freshItems.map((fresh) => preserveStableNewsMedia(fresh, previousById.get(fresh.id)));

  const minimumSafeCount = Math.ceil(previous.items.length * 0.5);
  if (previous.items.length >= 10 && items.length < minimumSafeCount) {
    throw new Error(
      `お知らせ件数が急減したため更新を停止します（${previous.items.length}件→${items.length}件）`,
    );
  }

  const data: NewsData = {
    generatedAt: new Date().toISOString(),
    items,
  };
  writeJson("news.json", data);
  logger.info(`done: お知らせ ${items.length}件`);
}

main().catch((e) => {
  logger.error(`generate-news failed: ${e}`);
  process.exitCode = 1;
});
