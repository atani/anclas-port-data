/**
 * 皇后杯（カップ戦）の勝ち上がりを events.json へ即座に反映するツール。
 *
 * matches.json はQリーグ公式サイトのみをスクレイピングする自動生成パイプラインの
 * 対象で、皇后杯のようなノックアウト方式のカップ戦は対象外のまま運用する（対戦相手が
 * 他都道府県の代表チームでQリーグに所属しないため、Qリーグの選手・順位データと
 * 突き合わせられない）。次戦が決まるたびに、このスクリプトで events.json の
 * お知らせ枠だけを更新する。
 *
 * 使い方:
 *   npx tsx src/advance-cup-event.ts \
 *     --round="2回戦" \
 *     --opponent="◯◯FC" \
 *     --date="2026-09-13" \
 *     --venue="長崎県 島原市営 平成町多目的広場" \
 *     [--time="14:00"] \
 *     [--source="https://..."] \
 *     [--tournament-id="empress-cup-2026"]
 *
 * 同じ--tournament-idを持つ既存のお知らせは自動で削除してから追加するため、
 * 前の回の告知が残り続けることはない。
 */
import { readFile, writeFile } from "node:fs/promises";

type EventItem = {
  id: string;
  title: string;
  summary: string;
  imageUrl?: string;
  startsAt: string;
  endsAt: string;
  periodLabel: string;
  actionTitle: string;
  actionUrl: string;
  priority: number;
};

type EventsFeed = {
  generatedAt: string;
  items: EventItem[];
};

const DEFAULT_IMAGE_URL = "https://anclas.jp/wp-content/uploads/2022/03/anclaslogo-1.png";
const DEFAULT_SOURCE_URL = "https://www.juniorsoccer-news.com/post-1937945";
const DEFAULT_TOURNAMENT_ID = "empress-cup-2026";
const TEAM_NAME = "福岡J・アンクラス";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (!match || !match[1] || match[2] === undefined) continue;
    args[match[1]] = match[2];
  }
  return args;
}

function requireArg(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) {
    throw new Error(`--${key} は必須です`);
  }
  return value;
}

function validHttpsURL(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const round = requireArg(args, "round");
  const opponent = requireArg(args, "opponent");
  const dateStr = requireArg(args, "date"); // YYYY-MM-DD
  const venue = requireArg(args, "venue");
  const time = args.time; // HH:MM、任意
  const sourceUrl = args.source ?? DEFAULT_SOURCE_URL;
  const imageUrl = args.image ?? DEFAULT_IMAGE_URL;
  const tournamentId = args["tournament-id"] ?? DEFAULT_TOURNAMENT_ID;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("--date は YYYY-MM-DD 形式で指定する");
  }
  if (!validHttpsURL(sourceUrl)) {
    throw new Error("--source はHTTPSのURLにする");
  }
  if (!validHttpsURL(imageUrl)) {
    throw new Error("--image はHTTPSのURLにする");
  }

  const [yStr, mStr, dStr] = dateStr.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  // 試合翌日の0時(JST)を終了時刻にする。当日中は告知を出し続ける。
  const startsAt = new Date().toISOString();
  const endsAtJst = `${new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)}T00:00:00+09:00`;

  const dateLabel = `${m}月${d}日`;
  const timeLabel = time ? ` ${time}キックオフ` : "";

  const eventsPath = new URL("../../events.json", import.meta.url);
  const feed: EventsFeed = JSON.parse(await readFile(eventsPath, "utf8"));

  // 同じ大会の前の回の告知を削除する（1トーナメントにつき常に最新の1件だけ残す）
  feed.items = feed.items.filter((item) => !item.id.startsWith(`${tournamentId}-`));

  const newItem: EventItem = {
    id: `${tournamentId}-${round.replace(/[^\p{L}\p{N}]/gu, "")}`,
    title: `皇后杯 ${round} の組合せ`,
    summary: `${dateLabel}${timeLabel}、${opponent}と${round}で対戦します。会場は${venue}です。`,
    imageUrl,
    startsAt,
    endsAt: endsAtJst,
    periodLabel: "開催期間",
    actionTitle: "詳細を見る",
    actionUrl: sourceUrl,
    priority: 100,
  };

  if (Date.parse(newItem.startsAt) >= Date.parse(newItem.endsAt)) {
    throw new Error("試合日が過去日になっている可能性がある。--date を確認する");
  }

  feed.items.push(newItem);
  await writeFile(eventsPath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");

  console.log(`追加しました: ${newItem.title}`);
  console.log(`  id: ${newItem.id}`);
  console.log(`  summary: ${newItem.summary}`);
  console.log(`  期間: ${newItem.startsAt} 〜 ${newItem.endsAt}`);
  console.log("");
  console.log("次の手順:");
  console.log("  1. git diff events.json で内容を確認する");
  console.log(`  2. ブランチを切ってPRを作る（対戦相手: ${opponent} / チーム: ${TEAM_NAME}）`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
