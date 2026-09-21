import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { logger } from "./lib/logger.js";
import {
  mergeSupplementalPlayers,
  parsePlayerPage,
  parsePlayerPageUrls,
  parsePlayerSeason,
  sortPlayers,
} from "./lib/player-parser.js";
import { parseStaff } from "./lib/staff-parser.js";
import type { Player, PlayerSns, PlayersData, Staff } from "./lib/types.js";
import {
  fetchPlayerBlogPosts,
  getPlayerArchiveHtml,
  getPlayerPageHtml,
  getStaffPageHtml,
} from "./lib/wordpress-client.js";

const DATA_DIR = new URL("../../", import.meta.url);

function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(new URL(name, DATA_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  logger.info(`wrote ${name}`);
}

/**
 * 公開一覧から取得した選手ブログを各選手へ紐付ける。
 * 件数が前回の半分を下回ったら例外にして、取得経路が壊れたまま上書きするのを防ぐ。
 */
async function linkBlogPosts(players: Player[], previousPlayers: Player[]): Promise<void> {
  const blogEntries = await fetchPlayerBlogPosts();
  const norm = (value: string) => value.replace(/[\s\u3000]/gu, "");
  let blogCount = 0;
  for (const player of players) {
    // 背番号一致 + 名前照合（背番号変更対策: 名前が含まれない場合は番号のみ）
    const matched = blogEntries.filter((entry) => {
      if (entry.number !== player.number) return false;
      if (entry.name && player.nameJa) {
        return norm(entry.name) === norm(player.nameJa)
          || norm(player.nameJa).includes(norm(entry.name))
          || norm(entry.name).includes(norm(player.nameJa));
      }
      return true;
    });
    if (matched.length > 0) {
      player.blogPosts = matched.map((entry) => entry.post);
      blogCount += player.blogPosts.length;
    }
  }
  const playersWithBlog = players.filter((player) => player.blogPosts.length > 0).length;
  logger.info(`ブログ: ${blogCount}記事を${playersWithBlog}選手に紐付け`);
  const previousBlogCount = previousPlayers.reduce(
    (total, player) => total + player.blogPosts.length,
    0,
  );
  if (previousBlogCount >= 10 && blogCount < Math.ceil(previousBlogCount * 0.5)) {
    throw new Error(
      `選手ブログ件数が急減したため更新を停止します（${previousBlogCount}件→${blogCount}件）`,
    );
  }
}

async function main(): Promise<void> {
  const previous = JSON.parse(
    readFileSync(new URL("players.json", DATA_DIR), "utf-8"),
  ) as PlayersData;
  const archiveHtml = await getPlayerArchiveHtml();
  const pageUrls = parsePlayerPageUrls(archiveHtml);
  if (pageUrls.length === 0) {
    throw new Error("公式選手一覧に選手カードが1件もありませんでした（改装の可能性）");
  }
  const minimumSafeCount = Math.ceil(previous.players.length * 0.75);
  if (previous.players.length >= 10 && pageUrls.length < minimumSafeCount) {
    throw new Error(
      `選手数が急減しました（${previous.players.length}人→${pageUrls.length}人）`,
    );
  }

  const detectedSeason = parsePlayerSeason(archiveHtml);
  if (!detectedSeason) {
    logger.warn(`公式一覧からシーズンを取得できないため前回値${previous.season}を維持します`);
  }
  const season = detectedSeason ?? previous.season;

  // 公式サイトへの負荷を抑えるため、個別ページは1件ずつ順に取得する。
  const fetched: Player[] = [];
  for (const url of pageUrls) {
    fetched.push(parsePlayerPage(await getPlayerPageHtml(url), url));
  }
  let players = sortPlayers(fetched);
  logger.info(`選手: ${players.length}人 / season=${season}`);

  // 顔写真が公式ページから消えた場合だけ前回値で埋める。
  // 投稿IDは改装で変わったため、氏名で前回データと突き合わせる。
  const normalizeName = (name: string): string => name.replace(/[\s　]/gu, "");
  const previousByName = new Map(
    previous.players.map((player) => [normalizeName(player.nameJa), player]),
  );
  for (const player of players) {
    const old = previousByName.get(normalizeName(player.nameJa));
    if (!old) continue;
    player.photo = {
      thumbnail: player.photo.thumbnail ?? old.photo.thumbnail,
      medium: player.photo.medium ?? old.photo.medium,
      large: player.photo.large ?? old.photo.large,
      full: player.photo.full ?? old.photo.full,
    };
  }

  // 公式プロフィールが通常の WordPress API に現れない途中加入選手を補完する。
  try {
    const supplementalPath = new URL("./data/player-additions.json", import.meta.url);
    const supplemental = JSON.parse(readFileSync(supplementalPath, "utf-8")) as Player[];
    const previousCount = players.length;
    players = mergeSupplementalPlayers(players, supplemental);
    const addedCount = players.length - previousCount;
    if (addedCount > 0) logger.info(`途中加入: ${addedCount}選手を補完`);
  } catch (error) {
    logger.warn(`途中加入選手の補完に失敗: ${error}`);
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

  await linkBlogPosts(players, previous.players);

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
