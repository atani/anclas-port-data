/**
 * 皇后杯（カップ戦）の勝ち上がりを manual-matches.json へ即座に反映するツール。
 *
 * matches.json はQリーグ公式サイトのみをスクレイピングする自動生成パイプラインの
 * 対象で、皇后杯のようなノックアウト方式のカップ戦は対象外のまま運用する（対戦相手が
 * 他都道府県の代表チームでQリーグに所属しないため、Qリーグの選手・順位データと
 * 突き合わせられない）。次戦が決まるたびに、このスクリプトで manual-matches.json を
 * 更新する。generate-matches.tsが毎回このファイルをmatches.jsonへ合成するため、
 * アプリの日程画面・ホーム画面の「次の試合」にそのまま反映される。
 *
 * 使い方（次戦を追加する場合）:
 *   npx tsx src/advance-cup-match.ts \
 *     --id="empress-cup-2026-round2" \
 *     --round="2回戦" \
 *     --opponent="対戦相手チーム名" \
 *     --date="2026-09-13" \
 *     --venue="長崎県 島原市営 平成町多目的広場" \
 *     [--time="14:00"] \
 *     [--source="https://..."]
 *
 * --round は自由記述。準決勝以降は "準決勝" / "決勝" を渡す
 * （--competition="皇后杯 準決勝" のように出来上がる。回戦番号を数える必要はない）。
 *
 * 使い方（前回の試合結果を確定させる場合）:
 *   npx tsx src/advance-cup-match.ts \
 *     --id="empress-cup-2026-round1" \
 *     --result-home=2 --result-away=1
 *
 * --result-home/--result-away を指定すると、指定した--idの試合をstatus:"finished"へ
 * 更新するだけで、新しい試合は追加しない。次戦を同時に追加したい場合は、
 * このツールを2回（結果確定→次戦追加の順）実行する。
 */
import { readFile, writeFile } from "node:fs/promises";

type ManualMatchStatus = "scheduled" | "finished";

type ManualMatchInput = {
  id: string;
  competition: string;
  date: string;
  kickoff: string | null;
  homeTeam: string;
  awayTeam: string;
  status: ManualMatchStatus;
  score: { home: number; away: number } | null;
  venue: string | null;
  sourceUrl: string;
};

type ManualMatchesFile = {
  matches: ManualMatchInput[];
};

const DEFAULT_COMPETITION = "皇后杯";
const DEFAULT_SOURCE_URL = "https://www.juniorsoccer-news.com/post-1937945";
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

function validHttpsURL(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const id = args.id;
  if (!id) throw new Error("--id は必須です");

  const path = new URL("../../manual-matches.json", import.meta.url);
  const file: ManualMatchesFile = JSON.parse(await readFile(path, "utf8"));

  const resultHome = args["result-home"];
  const resultAway = args["result-away"];
  if (resultHome !== undefined || resultAway !== undefined) {
    // 結果確定モード: 既存の対戦カードをfinishedへ更新するだけ
    if (resultHome === undefined || resultAway === undefined) {
      throw new Error("--result-home と --result-away は両方指定する");
    }
    const home = Number(resultHome);
    const away = Number(resultAway);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      throw new Error("--result-home/--result-away は0以上の整数にする");
    }
    const target = file.matches.find((m) => m.id === id);
    if (!target) throw new Error(`id=${id} の対戦カードが manual-matches.json に見つからない`);
    target.status = "finished";
    target.score = { home, away };
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    console.log(`結果を確定しました: ${target.homeTeam} ${home}-${away} ${target.awayTeam}`);
    console.log("次の手順: git diff manual-matches.json で内容を確認し、PRを作る");
    return;
  }

  // 新規追加モード
  const round = args.round;
  const opponent = args.opponent;
  const dateStr = args.date;
  const venue = args.venue;
  if (!round || !opponent || !dateStr || !venue) {
    throw new Error("新規追加には --round --opponent --date --venue が必須");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("--date は YYYY-MM-DD 形式で指定する");
  }
  const time = args.time ?? null;
  const sourceUrl = args.source ?? DEFAULT_SOURCE_URL;
  const competition = args.competition ?? `${DEFAULT_COMPETITION} ${round}`;
  if (!validHttpsURL(sourceUrl)) {
    throw new Error("--source はHTTPSのURLにする");
  }
  if (file.matches.some((m) => m.id === id)) {
    throw new Error(`id=${id} は既に存在する（--idを変えるか、結果確定モードを使う）`);
  }

  const newMatch: ManualMatchInput = {
    id,
    competition,
    date: dateStr,
    kickoff: time,
    homeTeam: TEAM_NAME,
    awayTeam: opponent,
    status: "scheduled",
    score: null,
    venue,
    sourceUrl,
  };
  file.matches.push(newMatch);
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");

  console.log(`追加しました: ${competition} ${TEAM_NAME} vs ${opponent}`);
  console.log(`  id: ${id}`);
  console.log(`  日程: ${dateStr}${time ? ` ${time}` : ""} @ ${venue}`);
  console.log("");
  console.log("次の手順:");
  console.log("  1. git diff manual-matches.json で内容を確認する");
  console.log("  2. ブランチを切ってPRを作る");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
