import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { logger } from "./lib/logger.js";
import { parsePartners } from "./lib/partner-parser.js";
import type { PartnersData } from "./lib/types.js";

const TOP_URL = "https://anclas.jp/";
const DATA_DIR = new URL("../../", import.meta.url);

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "anclas-port-pipeline (+https://github.com/atani/anclas-port-data)" },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} ${url}`);
  return res.text();
}

function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(new URL(name, DATA_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  logger.info(`wrote ${name}`);
}

async function main(): Promise<void> {
  const html = await fetchHtml(TOP_URL);
  const partners = parsePartners(html);
  if (partners.length === 0) {
    throw new Error("オフィシャルパートナーを1社も抽出できませんでした（サイト構造変更の可能性）");
  }

  const previous = JSON.parse(
    readFileSync(new URL("partners.json", DATA_DIR), "utf-8"),
  ) as PartnersData;
  const minimumSafeCount = Math.ceil(previous.partners.length * 0.75);
  if (previous.partners.length >= 20 && partners.length < minimumSafeCount) {
    throw new Error(
      `パートナー数が急減したため更新を停止します（${previous.partners.length}社→${partners.length}社）`,
    );
  }

  const data: PartnersData = {
    generatedAt: new Date().toISOString(),
    partners,
  };
  writeJson("partners.json", data);

  const linked = partners.filter((p) => p.url).length;
  logger.info(`done: ${partners.length}社 / リンクあり${linked}`);
}

main().catch((err) => {
  logger.error(`失敗: ${err instanceof Error ? err.message : err}`);
  logger.warn("パートナーデータは前回の生成物を維持します（anclas.jp が一時的にアクセス不可の可能性）");
  process.exit(1);
});
