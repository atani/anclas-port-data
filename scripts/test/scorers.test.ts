import assert from "node:assert/strict";
import { test } from "node:test";
import { computeScorers } from "../src/lib/scorers.js";
import { ANCLAS_TEAM_NAME, type Match, type ScorerRank } from "../src/lib/types.js";

function match(goals: Match["goals"]): Pick<Match, "status" | "isAnclas" | "goals"> {
  return { status: "finished", isAnclas: true, goals };
}

test("computeScorers: 試合記録を正としてランキング側の得点者誤りを補正する", () => {
  const source: ScorerRank[] = [
    { rank: 1, leagueRank: 9, name: "玉城 薪瀬", number: 18, goals: 2 },
    { rank: 2, leagueRank: 20, name: "嘉数 クレア姫麗", number: 11, goals: 1 },
  ];
  const scorers = computeScorers(
    [
      match([
        {
          minute: "18分",
          team: ANCLAS_TEAM_NAME,
          playerNumber: 18,
          playerName: "玉城 薪瀬",
          assist: null,
        },
        {
          minute: "69分",
          team: ANCLAS_TEAM_NAME,
          playerNumber: 23,
          playerName: "北条あゆみ",
          assist: null,
        },
        {
          minute: "80分",
          team: ANCLAS_TEAM_NAME,
          playerNumber: 11,
          playerName: "嘉数 クレア姫麗",
          assist: null,
        },
      ]),
    ],
    source,
    new Map([
      ["玉城薪瀬", 18],
      ["北条あゆみ", 23],
      ["嘉数クレア姫麗", 11],
    ]),
  );

  assert.deepEqual(
    scorers.map(({ rank, leagueRank, name, goals }) => ({ rank, leagueRank, name, goals })),
    [
      { rank: 1, leagueRank: 20, name: "嘉数 クレア姫麗", goals: 1 },
      { rank: 1, leagueRank: null, name: "玉城 薪瀬", goals: 1 },
      { rank: 1, leagueRank: null, name: "北条あゆみ", goals: 1 },
    ],
  );
});

test("computeScorers: 未消化試合とオウンゴールを集計しない", () => {
  const goal = {
    minute: "10分",
    team: ANCLAS_TEAM_NAME,
    playerNumber: null,
    playerName: "オウンゴール",
    assist: null,
  };

  assert.deepEqual(
    computeScorers(
      [
        match([goal]),
        { status: "scheduled", isAnclas: true, goals: [{ ...goal, playerName: "選手A" }] },
      ],
      [],
      new Map(),
    ),
    [],
  );
});
