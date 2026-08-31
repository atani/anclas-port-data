import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { logger } from "./lib/logger.js";
import { parsePlayer, reconcilePublishedPlayers, sortPlayers } from "./lib/player-parser.js";
import { parseStaff } from "./lib/staff-parser.js";
import type { Player, PlayerSns, PlayersData, Staff } from "./lib/types.js";
import {
  fetchPlayerBlogPosts,
  getPlayerCategory,
  getPlayerPosts,
  getPublishedPlayerUrls,
  getStaffPageHtml,
} from "./lib/wordpress-client.js";

const DATA_DIR = new URL("../../", import.meta.url);

function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(new URL(name, DATA_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  logger.info(`wrote ${name}`);
}

async function main(): Promise<void> {
  const previous = JSON.parse(
    readFileSync(new URL("players.json", DATA_DIR), "utf-8"),
  ) as PlayersData;
  let season: string;
  let players: Player[];
  let loadedFreshProfiles = false;

  try {
    const category = await getPlayerCategory();
    logger.info(`選手カテゴリ: id=${category.id} name=${category.name} season=${category.season}`);
    const posts = await getPlayerPosts(category.id);
    if (posts.length === 0) {
      throw new Error("選手投稿が0件でした（カテゴリ変更の可能性）");
    }
    season = category.season;
    players = sortPlayers(posts.map(parsePlayer));
    const minimumSafeCount = Math.ceil(previous.players.length * 0.75);
    if (previous.players.length >= 10 && players.length < minimumSafeCount) {
      throw new Error(
        `選手数が急減しました（${previous.players.length}人→${players.length}人）`,
      );
    }
    const previousById = new Map(previous.players.map((player) => [player.id, player]));
    for (const player of players) {
      const old = previousById.get(player.id);
      if (old?.photo.large && !player.photo.large) {
        player.photo.large = old.photo.large;
      }
    }
    loadedFreshProfiles = true;
  } catch (error) {
    logger.warn(`WordPress APIからの選手生成に失敗。公式一覧HTMLで整合します: ${error}`);
    const reconciliation = reconcilePublishedPlayers(previous.players, await getPublishedPlayerUrls());
    season = previous.season;
    players = reconciliation.players;
    for (const player of reconciliation.removed) {
      logger.info(`公式一覧から削除: #${player.number ?? "-"} ${player.nameJa}`);
    }
    if (reconciliation.missingUrls.length > 0) {
      logger.warn(`公式一覧に新規選手${reconciliation.missingUrls.length}件あり（API復旧後にプロフィールを追加）`);
    }
  }

  let staff: Staff[] = previous.staff ?? [];
  try {
    const freshStaff = parseStaff(await getStaffPageHtml());
    if (freshStaff.length === 0) {
      throw new Error("公式スタッフ紹介が0件でした");
    }
    if (staff.length >= 2 && freshStaff.length < Math.ceil(staff.length * 0.5)) {
      throw new Error(`スタッフ数が急減しました（${staff.length}人→${freshStaff.length}人）`);
    }
    staff = freshStaff;
    logger.info(`スタッフ: ${staff.length}人`);
  } catch (error) {
    logger.warn(`スタッフ取得に失敗。前回値${staff.length}人を維持します: ${error}`);
  }

  if (loadedFreshProfiles) {
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
    const previousBlogCount = previous.players.reduce(
      (total, player) => total + player.blogPosts.length,
      0,
    );
    if (previousBlogCount >= 10 && blogCount < Math.ceil(previousBlogCount * 0.5)) {
      throw new Error(
        `選手ブログ件数が急減したため更新を停止します（${previousBlogCount}件→${blogCount}件）`,
      );
    }
  }

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
    season,
    players,
    staff,
  };
  writeJson("players.json", data);

  const missingNumber = players.filter((p) => p.number === null).length;
  logger.info(`done: ${players.length}選手 / season=${season} / 背番号欠損${missingNumber}`);
}

main().catch((err) => {
  logger.error(`失敗: ${err instanceof Error ? err.message : err}`);
  logger.warn("選手データは前回の生成物を維持します（anclas.jp が一時的にアクセス不可の可能性）");
  process.exit(1);
});
