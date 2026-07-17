import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { logger } from "./lib/logger.js";
import { parsePlayer, sortPlayers } from "./lib/player-parser.js";
import type { PlayerSns, PlayersData } from "./lib/types.js";
import { fetchPlayerBlogPosts, getPlayerCategory, getPlayerPosts } from "./lib/wordpress-client.js";

const DATA_DIR = new URL("../../", import.meta.url);

function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(new URL(name, DATA_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  logger.info(`wrote ${name}`);
}

async function main(): Promise<void> {
  const category = await getPlayerCategory();
  logger.info(`選手カテゴリ: id=${category.id} name=${category.name} season=${category.season}`);

  const posts = await getPlayerPosts(category.id);
  if (posts.length === 0) {
    throw new Error("選手投稿が0件でした（カテゴリ変更の可能性）");
  }

  const players = sortPlayers(posts.map(parsePlayer));

  const blogEntries = await fetchPlayerBlogPosts();
  const norm = (s: string) => s.replace(/[\s　]/g, "");
  let blogCount = 0;
  for (const p of players) {
    // 背番号一致 + 名前照合（背番号変更対策: 名前が含まれない場合は番号のみ）
    const matched = blogEntries.filter((e) => {
      if (e.number !== p.number) return false;
      if (e.name && p.nameJa) {
        return norm(e.name) === norm(p.nameJa) || norm(p.nameJa).includes(norm(e.name)) || norm(e.name).includes(norm(p.nameJa));
      }
      return true;
    });
    if (matched.length > 0) {
      p.blogPosts = matched.map((e) => e.post);
      blogCount += p.blogPosts.length;
    }
  }
  const playersWithBlog = players.filter((p) => p.blogPosts.length > 0).length;
  logger.info(`ブログ: ${blogCount}記事を${playersWithBlog}選手に紐付け`);

  // SNS アカウント（手動管理の JSON）
  try {
    const snsPath = new URL("./data/player-sns.json", import.meta.url);
    const snsData = JSON.parse(readFileSync(snsPath, "utf-8")) as Record<string, PlayerSns>;
    let snsCount = 0;
    for (const p of players) {
      const key = String(p.number);
      if (snsData[key] && Object.keys(snsData[key]).some((k) => k !== "_comment")) {
        p.sns = snsData[key];
        snsCount++;
      }
    }
    if (snsCount > 0) logger.info(`SNS: ${snsCount}選手に紐付け`);
  } catch {
    // SNS ファイルが無くても問題ない
  }

  // キャプテン・副キャプテン（手動管理の JSON、背番号キー）
  try {
    const rolesPath = new URL("./data/player-roles.json", import.meta.url);
    const rolesData = JSON.parse(readFileSync(rolesPath, "utf-8")) as Record<string, string>;
    let roleCount = 0;
    for (const p of players) {
      const role = rolesData[String(p.number)];
      if (role === "captain" || role === "vice_captain") {
        p.role = role;
        roleCount++;
      }
    }
    if (roleCount > 0) logger.info(`役職: ${roleCount}選手に紐付け`);
  } catch {
    // 役職ファイルが無くても問題ない
  }

  const data: PlayersData = {
    generatedAt: new Date().toISOString(),
    season: category.season,
    players,
  };
  writeJson("players.json", data);

  const missingNumber = players.filter((p) => p.number === null).length;
  logger.info(`done: ${players.length}選手 / season=${category.season} / 背番号欠損${missingNumber}`);
}

main().catch((err) => {
  logger.error(`失敗: ${err instanceof Error ? err.message : err}`);
  logger.warn("選手データは前回の生成物を維持します（anclas.jp が一時的にアクセス不可の可能性）");
  process.exit(1);
});
