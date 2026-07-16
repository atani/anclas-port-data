import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseQLeagueMatches } from "../src/lib/qleague-parser.js";
import { calculateStandings } from "../src/lib/standings.js";
import type { Match } from "../src/lib/types.js";

function m(home: string, away: string, hs: number, as: number): Match {
  return {
    id: `t-${home}-${away}`,
    competition: "Qリーグ",
    round: null,
    date: "2026-04-12",
    kickoff: "12:00",
    datetime: "2026-04-12T12:00:00+09:00",
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: hs, away: as },
    isAnclas: home === "福岡J・アンクラス" || away === "福岡J・アンクラス",
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

test("calculateStandings: 勝点・得失点・並び順", () => {
  const table = calculateStandings([
    m("A", "B", 2, 0), // A win
    m("B", "C", 1, 1), // draw
    m("C", "A", 0, 3), // A win
  ]);
  const a = table.find((r) => r.team === "A")!;
  assert.equal(a.played, 2);
  assert.equal(a.win, 2);
  assert.equal(a.points, 6);
  assert.equal(a.gf, 5);
  assert.equal(a.ga, 0);
  assert.equal(a.gd, 5);
  assert.equal(table[0]!.team, "A"); // 勝点最多が先頭
});

test("calculateStandings: scheduled は集計しない", () => {
  const scheduled: Match = { ...m("A", "B", 0, 0), status: "scheduled", score: null };
  const table = calculateStandings([scheduled]);
  assert.equal(table.length, 0);
});

test("calculateStandings: 同勝点は得失点差→総得点で決まる", () => {
  const table = calculateStandings([
    m("X", "Y", 5, 0), // X +5
    m("Z", "W", 1, 0), // Z +1
    m("Y", "X", 0, 0), // draw → X,Y 1点ずつ
    m("W", "Z", 0, 0), // draw → Z,W 1点ずつ
  ]);
  // X: 1勝1分=4点 gd+5 / Z: 1勝1分=4点 gd+1 → X が上
  const xi = table.findIndex((r) => r.team === "X");
  const zi = table.findIndex((r) => r.team === "Z");
  assert.ok(xi < zi);
});

test("calculateStandings: 実fixtureでアンクラスが首位、合計試合数が整合", () => {
  const matches = parseQLeagueMatches(
    readFileSync(fileURLToPath(new URL("./fixtures/qleague-match.html", import.meta.url)), "utf-8"),
  );
  const table = calculateStandings(matches);
  assert.equal(table.length, 8);
  assert.equal(table[0]!.team, "福岡J・アンクラス");
  assert.ok(table[0]!.isAnclas);
  // 各チームの played 合計 = finished 試合数 × 2
  const finished = matches.filter((x) => x.status === "finished").length;
  const totalPlayed = table.reduce((s, r) => s + r.played, 0);
  assert.equal(totalPlayed, finished * 2);
});
