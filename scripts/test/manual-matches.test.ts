import assert from "node:assert/strict";
import test from "node:test";
import { loadManualMatches } from "../src/lib/manual-matches.js";
import { ANCLAS_TEAM_NAME } from "../src/lib/types.js";

test("loadManualMatches: manual-matches.jsonをMatch型として正しく読み込む", () => {
  const matches = loadManualMatches();
  assert.ok(matches.length > 0, "manual-matches.jsonに少なくとも1件は登録されている");

  const ids = new Set<string>();
  for (const m of matches) {
    assert.ok(!ids.has(m.id), `id must be unique: ${m.id}`);
    ids.add(m.id);

    assert.ok(m.competition.length > 0, `${m.id}.competition must not be empty`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(m.date), `${m.id}.date must be YYYY-MM-DD`);
    assert.ok(Number.isFinite(Date.parse(m.datetime)), `${m.id}.datetime must be a valid ISO8601 date`);
    assert.match(m.datetime, /\+09:00$/, `${m.id}.datetime must be JST (+09:00)`);
    assert.equal(
      m.isAnclas,
      m.homeTeam === ANCLAS_TEAM_NAME || m.awayTeam === ANCLAS_TEAM_NAME,
      `${m.id}.isAnclas must reflect whether ${ANCLAS_TEAM_NAME} is playing`,
    );
    assert.ok(["scheduled", "finished"].includes(m.status), `${m.id}.status must be scheduled or finished`);
    if (m.status === "scheduled") {
      assert.equal(m.score, null, `${m.id}.score must be null while scheduled`);
    }
    if (m.status === "finished") {
      assert.ok(m.score !== null, `${m.id}.score must be set once finished`);
    }
    // GoalNote由来のフィールドは手動データには無いため、常に空のプレースホルダになる
    assert.deepEqual(m.goals, []);
    assert.deepEqual(m.starters, []);
    assert.equal(m.goalnoteUrl, null);
  }
});

test("loadManualMatches: 皇后杯1回戦が正しい対戦カードで登録されている", () => {
  const matches = loadManualMatches();
  const round1 = matches.find((m) => m.id === "empress-cup-2026-round1");
  assert.ok(round1, "empress-cup-2026-round1 が存在する");
  assert.equal(round1?.competition, "皇后杯 1回戦");
  assert.equal(round1?.isAnclas, true);
  assert.equal(round1?.date, "2026-09-12");
  assert.equal(round1?.homeTeam, ANCLAS_TEAM_NAME);
  assert.equal(round1?.awayTeam, "活水女子大学サッカー部");
});
