import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { logger } from "./lib/logger.js";
import { syncNews } from "./lib/news-sync.js";
import type { NewsData } from "./lib/types.js";

const DATA_DIR = new URL("../../", import.meta.url);

function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(new URL(name, DATA_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  logger.info(`wrote ${name}`);
}

async function main(): Promise<void> {
  const previous = JSON.parse(
    readFileSync(new URL("news.json", DATA_DIR), "utf-8"),
  ) as NewsData;
  // 差分同期の設計は lib/news-sync.ts の先頭コメント参照。
  await syncNews({
    previous,
    write: (data) => writeJson("news.json", data),
    forceRefresh: process.env.ANCLAS_NEWS_FORCE_REFRESH === "1",
  });
}

main().catch((e) => {
  logger.error(`generate-news failed: ${e}`);
  process.exitCode = 1;
});
