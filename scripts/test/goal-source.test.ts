import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldUseReportedGoals } from "../src/lib/goal-source.js";

test("GoalNoteの得点数がスコアと一致する場合は得点者名が違っても上書きしない", () => {
  assert.equal(shouldUseReportedGoals(2, 2, 2), false);
});

test("GoalNoteの得点が欠け、試合レポートの件数がスコアと一致する場合だけ補完する", () => {
  assert.equal(shouldUseReportedGoals(1, 2, 2), true);
  assert.equal(shouldUseReportedGoals(1, 2, 1), false);
});
