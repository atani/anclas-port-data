import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeTeamName,
  parseMatchLine,
  parseQLeagueMatches,
} from "../src/lib/qleague-parser.js";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/qleague-match.html", import.meta.url)),
  "utf-8",
);

test("parseMatchLine: 確定スコア（チーム名とスコアの間にスペース）", () => {
  const r = parseMatchLine("2026/04/12 12:00 福岡J・アンクラス 【2-2】ヴィアマテラス宮崎Alegrita");
  assert.deepEqual(r, {
    date: "2026-04-12",
    kickoff: "12:00",
    homeTeam: "福岡J・アンクラス",
    awayTeam: "ヴィアマテラス宮崎Alegrita",
    status: "finished",
    score: { home: 2, away: 2 },
  });
});

test("parseMatchLine: 確定スコア（スペース無し）", () => {
  const r = parseMatchLine("2026/05/03 12:00 福岡J・アンクラス【3-0】国見FCレディース");
  assert.equal(r?.status, "finished");
  assert.deepEqual(r?.score, { home: 3, away: 0 });
  assert.equal(r?.homeTeam, "福岡J・アンクラス");
  assert.equal(r?.awayTeam, "国見FCレディース");
});

test("parseMatchLine: 未消化（vs）", () => {
  const r = parseMatchLine("2026/06/27 12:00 福岡J・アンクラス【vs】水俣ユニオンフットボールクラブウィメン");
  assert.equal(r?.status, "scheduled");
  assert.equal(r?.score, null);
});

test("parseMatchLine: タブ区切り", () => {
  const r = parseMatchLine("2026/04/11\t 11:00 ＦＣ琉球さくら【2-0】水俣ユニオンフットボールクラブウィメン");
  assert.equal(r?.kickoff, "11:00");
  assert.equal(r?.homeTeam, "FC琉球さくら"); // 全角ＦＣ→半角
});

test("parseMatchLine: 時刻直結（11:00八女学院）", () => {
  const r = parseMatchLine("2026/11/07 11:00八女学院女子サッカー部【vs】琉球デイゴス");
  assert.equal(r?.kickoff, "11:00");
  assert.equal(r?.homeTeam, "八女学院女子サッカー部");
});

test("parseMatchLine: 時刻未定（（調整中）混入）", () => {
  const r = parseMatchLine("2026/09/12 （調整中） 秀岳館高等学校【vs】琉球デイゴス");
  assert.equal(r?.kickoff, null);
  assert.equal(r?.homeTeam, "秀岳館高等学校");
});

test("parseMatchLine: チーム名内の全角スペースは保持", () => {
  const r = parseMatchLine("2026/05/24 12:00 福岡J・アンクラス 【2-0】柳ヶ浦高等学校　女子サッカー部");
  assert.equal(r?.awayTeam, "柳ヶ浦高等学校　女子サッカー部");
});

test("normalizeTeamName: 東海大の表記揺れを吸収", () => {
  assert.equal(normalizeTeamName("東海大付属福岡高等学校"), "東海大学付属福岡高等学校");
  assert.equal(normalizeTeamName("東海大学付属福岡高等学校"), "東海大学付属福岡高等学校");
});

test("parseQLeagueMatches: アンクラスのセクションのみ抽出（8チーム）", () => {
  const matches = parseQLeagueMatches(fixture);
  const teams = new Set<string>();
  for (const m of matches) {
    teams.add(m.homeTeam);
    teams.add(m.awayTeam);
  }
  assert.equal(teams.size, 8, `8チームのはず: ${[...teams].join(", ")}`);
  assert.ok(teams.has("福岡J・アンクラス"));
  // 別リーグ（1部/2部）のチームが混入していないこと
  assert.ok(!teams.has("琉球デイゴス"));
  assert.ok(!teams.has("MIGOCARISA鹿児島"));
});

test("parseQLeagueMatches: 全試合に isAnclas が付与され、アンクラス試合が存在", () => {
  const matches = parseQLeagueMatches(fixture);
  assert.ok(matches.length > 0);
  assert.ok(matches.some((m) => m.isAnclas));
  // finished には score、scheduled には null
  for (const m of matches) {
    if (m.status === "finished") assert.ok(m.score, `${m.id} finished だが score 無し`);
    else assert.equal(m.score, null);
  }
});

test("parseQLeagueMatches: 日時昇順に整列されている", () => {
  const matches = parseQLeagueMatches(fixture);
  for (let i = 1; i < matches.length; i++) {
    assert.ok(
      matches[i - 1]!.datetime <= matches[i]!.datetime,
      `${matches[i - 1]!.datetime} <= ${matches[i]!.datetime}`,
    );
  }
});
