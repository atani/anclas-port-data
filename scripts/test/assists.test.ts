import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAssists, parseAssistNumber } from "../src/lib/assists.js";
import { ANCLAS_TEAM_NAME, type GoalEvent, type Match } from "../src/lib/types.js";

// --- parseAssistNumber ---

test("parseAssistNumber: 矢印区切りの先頭背番号を抽出する", () => {
  assert.equal(parseAssistNumber("22→11S"), 22);
  assert.equal(parseAssistNumber("5↑13S"), 5);
  assert.equal(parseAssistNumber("15浮き球パス→5ヘディング"), 15);
  assert.equal(parseAssistNumber("13ゴロパス→22浮き球パス→10シュート"), 13);
});

test("parseAssistNumber: PK・ダイレクト・単独はアシストなし", () => {
  assert.equal(parseAssistNumber("16PK"), null, "PK");
  assert.equal(parseAssistNumber("×11S"), null, "ダイレクト");
  assert.equal(parseAssistNumber("11S"), null, "矢印なし");
  assert.equal(parseAssistNumber(null), null, "null");
  assert.equal(parseAssistNumber("クリア→12シュート"), null, "先頭に数字なし");
});

// --- computeAssists ---

function goal(team: string, assist: string | null): GoalEvent {
  return { minute: "10分", team, playerNumber: 9, playerName: "選手", assist };
}

function makeMatch(goals: GoalEvent[], overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    competition: "Qリーグ",
    round: 1,
    date: "2026-04-12",
    kickoff: "13:00",
    datetime: "2026-04-12T13:00:00+09:00",
    homeTeam: ANCLAS_TEAM_NAME,
    awayTeam: "相手チーム",
    status: "finished",
    score: { home: 1, away: 0 },
    isAnclas: true,
    sourceUrl: "",
    venue: null,
    goals,
    starters: [],
    subs: [],
    substitutions: [],
    stats: null,
    goalnoteUrl: null,
    posterUrl: null,
    matchdayProgramUrl: null,
    cards: [],
    matchReport: null,
    photoGallery: [],
    forecast: null,
    ...overrides,
  };
}

const numberByName = new Map<string, number>([
  ["原日樺", 13],
  ["田中花奈", 15],
]);
const roster = new Set<number>([13, 15, 22]);

test("computeAssists: アシスト数を集計し名前を補完する", () => {
  const matches = [
    makeMatch([goal(ANCLAS_TEAM_NAME, "13→18S"), goal(ANCLAS_TEAM_NAME, "13↑9S")]),
    makeMatch([goal(ANCLAS_TEAM_NAME, "15→11S")]),
  ];
  const result = computeAssists(matches, roster, numberByName);

  assert.equal(result.length, 2);
  assert.equal(result[0]?.number, 13);
  assert.equal(result[0]?.assists, 2);
  assert.equal(result[0]?.name, "原日樺", "名前が逆引きされる");
  assert.equal(result[1]?.number, 15);
  assert.equal(result[1]?.assists, 1);
});

test("computeAssists: PK・ダイレクト・相手チームの得点は除外", () => {
  const matches = [
    makeMatch([
      goal(ANCLAS_TEAM_NAME, "16PK"),
      goal(ANCLAS_TEAM_NAME, "×11S"),
      goal("相手チーム", "13→18S"),
    ]),
  ];
  assert.equal(computeAssists(matches, roster, numberByName).length, 0);
});

test("computeAssists: ロスター外の背番号は除外", () => {
  const matches = [makeMatch([goal(ANCLAS_TEAM_NAME, "99→11S")])];
  assert.equal(computeAssists(matches, roster, numberByName).length, 0, "99は名鑑にいない");
});

test("computeAssists: 同アシスト数は同順位（1,1,3形式）", () => {
  const matches = [
    makeMatch([
      goal(ANCLAS_TEAM_NAME, "13→1S"),
      goal(ANCLAS_TEAM_NAME, "13→2S"),
      goal(ANCLAS_TEAM_NAME, "15→3S"),
      goal(ANCLAS_TEAM_NAME, "15→4S"),
      goal(ANCLAS_TEAM_NAME, "22→5S"),
    ]),
  ];
  const result = computeAssists(matches, roster, numberByName);
  assert.deepEqual(
    result.map((r) => [r.rank, r.assists]),
    [[1, 2], [1, 2], [3, 1]],
  );
});

test("computeAssists: 未消化試合・名鑑にない選手名はフォールバック表記", () => {
  const matches = [
    makeMatch([goal(ANCLAS_TEAM_NAME, "22→11S")]),
    makeMatch([goal(ANCLAS_TEAM_NAME, "13→11S")], { status: "scheduled" }),
  ];
  const result = computeAssists(matches, roster, numberByName);
  assert.equal(result.length, 1, "scheduled は集計しない");
  assert.equal(result[0]?.name, "#22", "名前が引けない場合は #番号");
});
