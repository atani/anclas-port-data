import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { logger } from "./lib/logger.js";
import { selectNewsThumbnail } from "./lib/news-thumbnail.js";
import type { NewsData, NewsItem } from "./lib/types.js";
import { getCategories, getPosts, selectNewsCategory } from "./lib/wordpress-client.js";

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

async function main(): Promise<void> {
  // 「お知らせ」カテゴリを名前で動的検出（id 固定にしない）
  const categories = await getCategories();
  const newsCategory = selectNewsCategory(categories);
  if (!newsCategory) {
    throw new Error("お知らせカテゴリが見つかりませんでした");
  }
  logger.info(`お知らせカテゴリ: id=${newsCategory.id} count=${newsCategory.count}`);

  // マッチレポートは「お知らせ」にもクロス投稿されるが、アプリでは試合詳細に
  // 表示済みのため「試合」カテゴリ付きの投稿を除外する
  const matchCategoryId = categories.find((c) => c.name === "試合")?.id;

  const posts = await getPosts({
    categories: [newsCategory.id],
    perPage: NEWS_LIMIT * 2,
    embed: true,
  });
  if (posts.length === 0) {
    throw new Error("お知らせ投稿が0件でした");
  }

  const filtered = posts
    .filter((p) => matchCategoryId == null || !p.categories.includes(matchCategoryId))
    .slice(0, NEWS_LIMIT);

  const items: NewsItem[] = filtered.map((p) => {
    const media = p._embedded?.["wp:featuredmedia"]?.[0];
    return {
      id: p.id,
      title: decodeEntities(p.title.rendered).trim(),
      date: p.date,
      url: p.link,
      thumbnailUrl: selectNewsThumbnail(media, p.content.rendered),
    };
  });

  const previous = JSON.parse(
    readFileSync(new URL("news.json", DATA_DIR), "utf-8"),
  ) as NewsData;
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
