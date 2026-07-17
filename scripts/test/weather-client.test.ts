import assert from "node:assert";
import { test } from "node:test";
import { pickNearestHourIndex } from "../src/lib/weather-client.js";

const times = [
  "2026-09-20T10:00",
  "2026-09-20T11:00",
  "2026-09-20T12:00",
  "2026-09-20T13:00",
];

test("pickNearestHourIndex: キックオフ時刻と一致する時間を選ぶ", () => {
  assert.equal(pickNearestHourIndex(times, "2026-09-20T12:00:00+09:00"), 2);
});

test("pickNearestHourIndex: 中間時刻は近い方に丸める", () => {
  assert.equal(pickNearestHourIndex(times, "2026-09-20T12:40:00+09:00"), 3);
});

test("pickNearestHourIndex: 範囲外は端に寄せる", () => {
  assert.equal(pickNearestHourIndex(times, "2026-09-20T08:00:00+09:00"), 0);
  assert.equal(pickNearestHourIndex(times, "2026-09-20T23:00:00+09:00"), 3);
});
