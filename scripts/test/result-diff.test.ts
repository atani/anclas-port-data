import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResultNotification,
  detectNewlyFinishedAnclasMatches,
} from "../src/lib/result-diff.js";
import { ANCLAS_TEAM_NAME, type Match, type MatchesData } from "../src/lib/types.js";

function match(
  id: string,
  home: string,
  away: string,
  status: "scheduled" | "finished",
  score: { home: number; away: number } | null,
): Match {
  return {
    id,
    competition: "Qリーグ",
    round: 5,
    date: "2026-07-15",
    kickoff: "18:00",
    datetime: "2026-07-15T18:00:00+09:00",
    homeTeam: home,
    awayTeam: away,
    status,
    score,
    isAnclas: home === ANCLAS_TEAM_NAME || away === ANCLAS_TEAM_NAME,
    sourceUrl: "",
    venue: null,
    goals: [],
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
  };
}

function matchesData(matches: Match[]): MatchesData {
  return {
    generatedAt: "2026-07-15T00:00:00.000Z",
    season: "2026",
    anclas: {
      nextMatch: null,
      latestResult: null,
      latestPodcast: null,
      latestYouTube: null,
      latestYouTubeShort: null,
      shopItems: [],
    },
    matches,
  };
}

test("detectNewlyFinished: scheduled→finished になったアンクラス試合を検出", () => {
  const prev = matchesData([match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "scheduled", null)]);
  const current = [match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "finished", { home: 2, away: 1 })];
  const newly = detectNewlyFinishedAnclasMatches(prev, current);
  assert.equal(newly.length, 1);
  assert.equal(newly[0]!.id, "m1");
});

test("detectNewlyFinished: 既に finished 済みは検出しない", () => {
  const prev = matchesData([match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "finished", { home: 2, away: 1 })]);
  const current = [match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "finished", { home: 2, away: 1 })];
  assert.equal(detectNewlyFinishedAnclasMatches(prev, current).length, 0);
});

test("detectNewlyFinished: アンクラス以外の確定は検出しない", () => {
  const prev = matchesData([match("m9", "A", "B", "scheduled", null)]);
  const current = [match("m9", "A", "B", "finished", { home: 1, away: 0 })];
  assert.equal(detectNewlyFinishedAnclasMatches(prev, current).length, 0);
});

test("detectNewlyFinished: 前回に存在しない新規確定試合も検出", () => {
  const prev = matchesData([]);
  const current = [match("m2", "水俣ユニオン", ANCLAS_TEAM_NAME, "finished", { home: 0, away: 3 })];
  const newly = detectNewlyFinishedAnclasMatches(prev, current);
  assert.equal(newly.length, 1);
  assert.equal(newly[0]!.id, "m2");
});

test("detectNewlyFinished: prev が null（初回生成）なら何も検出しない", () => {
  const current = [match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "finished", { home: 2, away: 1 })];
  assert.equal(detectNewlyFinishedAnclasMatches(null, current).length, 0);
});

test("detectNewlyFinished: finished でもスコアが無ければ検出しない", () => {
  const prev = matchesData([match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "scheduled", null)]);
  const current = [match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "finished", null)];
  assert.equal(detectNewlyFinishedAnclasMatches(prev, current).length, 0);
});

test("buildResultNotification: ホーム→アウェイの並びで短縮名の文面を作る", () => {
  const n = buildResultNotification(
    match("m1", ANCLAS_TEAM_NAME, "水俣ユニオン", "finished", { home: 2, away: 1 }),
  );
  assert.equal(n.title, "試合終了");
  assert.equal(n.body, "アンクラス 2 - 1 水俣ユニオン");
  assert.equal(n.matchId, "m1");
});

test("buildResultNotification: アウェイ戦もホーム→アウェイ並びを保つ", () => {
  const n = buildResultNotification(
    match("m2", "水俣ユニオン", ANCLAS_TEAM_NAME, "finished", { home: 0, away: 3 }),
  );
  assert.equal(n.body, "水俣ユニオン 0 - 3 アンクラス");
});
