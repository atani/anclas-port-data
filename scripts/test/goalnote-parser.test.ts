import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  enrichMatchesWithSchedule,
  parseGoalNoteGame,
  parseGoalNoteSchedule,
  parseScorerRanking,
} from "../src/lib/goalnote-parser.js";

const scheduleFix = readFileSync(
  fileURLToPath(new URL("./fixtures/goalnote-schedule.html", import.meta.url)),
  "utf-8",
);
const gameFix = readFileSync(
  fileURLToPath(new URL("./fixtures/goalnote-game.html", import.meta.url)),
  "utf-8",
);

test("parseGoalNoteSchedule: 全試合行を抽出し会場が含まれる", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  assert.ok(rows.length >= 40, `行数 ${rows.length}`);
  const anclas = rows.filter((r) => r.homeTeam.includes("アンクラス") || r.awayTeam.includes("アンクラス"));
  assert.ok(anclas.length >= 10, `アンクラス行 ${anclas.length}`);
  const withVenue = rows.filter((r) => r.venue);
  assert.ok(withVenue.length > rows.length * 0.5, "半数以上の行に会場がある");
  const withUrl = rows.filter((r) => r.gameUrl);
  assert.ok(withUrl.length > 0, "game URL がある行が存在する");
});

test("enrichMatchesWithSchedule: 日付+チーム名で会場を補完", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  const matches = [
    {
      date: "2026-04-12",
      homeTeam: "福岡J・アンクラス",
      awayTeam: "ヴィアマテラス宮崎Alegrita",
      venue: null as string | null,
      goalnoteUrl: null as string | null,
      status: "scheduled" as "scheduled" | "finished",
      score: null as { home: number; away: number } | null,
    },
  ];
  enrichMatchesWithSchedule(matches, rows);
  assert.ok(matches[0]!.venue, "会場が補完された");
  assert.ok(matches[0]!.goalnoteUrl, "game URL が補完された");
});

test("parseGoalNoteGame: 得点経過を抽出", () => {
  const data = parseGoalNoteGame(gameFix, "福岡J・アンクラス");
  assert.ok(data.goals.length >= 3, `ゴール数 ${data.goals.length}`);
  const og = data.goals.find((g) => g.playerName.includes("オウンゴール"));
  assert.ok(og, "オウンゴールが含まれる");
  assert.equal(og?.playerNumber, null);
  const kakazu = data.goals.find((g) => g.playerName.includes("嘉数"));
  assert.ok(kakazu, "嘉数 クレア姫麗のゴールが含まれる");
  assert.equal(kakazu?.playerNumber, 11);
});

test("parseGoalNoteGame: スタメン（ポジション付き）を抽出", () => {
  const data = parseGoalNoteGame(gameFix, "福岡J・アンクラス");
  assert.ok(data.starters.length >= 20, `スタメン ${data.starters.length}`);
  const homeStarters = data.starters.filter((p) => p.team === "home");
  assert.equal(homeStarters.length, 11, "ホームスタメン11人");
  const gk = homeStarters.find((p) => p.position === "GK");
  assert.ok(gk, "GK がいる");
  assert.equal(gk?.name, "釜坂 慧");
  const fw = homeStarters.filter((p) => p.position === "FW");
  assert.ok(fw.length >= 2, "FW が2人以上");
});

test("parseGoalNoteGame: 警告（イエローカード）を抽出", () => {
  const data = parseGoalNoteGame(gameFix, "福岡J・アンクラス");
  // fixture には田中花奈・森和奏のラフ（警告）が含まれる
  assert.ok(data.cards.length >= 2, `カード数 ${data.cards.length}`);
  const tanaka = data.cards.find((c) => c.name.includes("田中"));
  assert.ok(tanaka, "田中のカードがある");
  assert.equal(tanaka?.type, "yellow");
});

const rankingFix = readFileSync(
  fileURLToPath(new URL("./fixtures/goalnote-ranking.html", import.meta.url)),
  "utf-8",
);

test("parseScorerRanking: アンクラス選手のみ抽出し背番号を補完", () => {
  const numberByName = new Map<string, number>([
    ["嘉数クレア姫麗", 11],
    ["原日樺", 13],
  ]);
  const scorers = parseScorerRanking(rankingFix, numberByName);

  assert.ok(scorers.length >= 2, `アンクラス選手 ${scorers.length}人`);
  assert.ok(
    scorers.every((s) => s.goals > 0),
    "全員 goals > 0",
  );

  const kakazu = scorers.find((s) => s.name.includes("嘉数"));
  assert.ok(kakazu, "嘉数がいる");
  assert.equal(kakazu?.number, 11, "背番号がマップから補完される");
  assert.equal(kakazu?.leagueRank, 2, "リーグ順位は原典のまま");

  // マップに無い選手は number: null
  const unmapped = scorers.find((s) => !s.name.includes("嘉数") && !s.name.includes("原"));
  if (unmapped) assert.equal(unmapped.number, null, "未登録選手は null");
});

test("parseScorerRanking: チーム内順位は得点降順・同点同順位で振り直す", () => {
  const scorers = parseScorerRanking(rankingFix, new Map());
  // 得点が降順に並んでいる
  for (let i = 1; i < scorers.length; i++) {
    assert.ok(scorers[i - 1]!.goals >= scorers[i]!.goals, "得点降順");
  }
  // 先頭はチーム内1位
  assert.equal(scorers[0]?.rank, 1, "先頭はチーム1位");
  // 同点は同順位、次の順位は人数分飛ぶ（1,1,3 形式）
  for (let i = 1; i < scorers.length; i++) {
    const prev = scorers[i - 1]!;
    const cur = scorers[i]!;
    if (cur.goals === prev.goals) {
      assert.equal(cur.rank, prev.rank, "同点は同順位");
    } else {
      assert.equal(cur.rank, i + 1, "順位は人数分飛ぶ");
    }
  }
});

test("enrichMatchesWithSchedule: q-league未消化でもGoalNoteに結果があれば確定に昇格", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  const matches = [
    {
      date: "2026-04-12",
      homeTeam: "福岡J・アンクラス",
      awayTeam: "ヴィアマテラス宮崎Alegrita",
      venue: null as string | null,
      goalnoteUrl: null as string | null,
      status: "scheduled" as "scheduled" | "finished",
      score: null as { home: number; away: number } | null,
    },
  ];
  enrichMatchesWithSchedule(matches, rows);
  assert.equal(matches[0]!.status, "finished", "finished に昇格");
  assert.deepEqual(matches[0]!.score, { home: 2, away: 2 }, "GoalNote のスコアが入る");
});

test("enrichMatchesWithSchedule: 既にfinishedの試合のスコアは上書きしない", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  const matches = [
    {
      date: "2026-04-12",
      homeTeam: "福岡J・アンクラス",
      awayTeam: "ヴィアマテラス宮崎Alegrita",
      venue: null as string | null,
      goalnoteUrl: null as string | null,
      status: "finished" as "scheduled" | "finished",
      score: { home: 9, away: 9 } as { home: number; away: number } | null,
    },
  ];
  enrichMatchesWithSchedule(matches, rows);
  assert.deepEqual(matches[0]!.score, { home: 9, away: 9 }, "q-league確定値を維持");
});
