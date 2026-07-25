import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReportedGoals } from "../src/lib/wordpress-client.js";

test("parseReportedGoals: 前後半の得点とオウンゴールを通算分へ変換する", () => {
  const html = `
    <p>得点：#3澁澤光、#16端山新、オウンゴール</p>
    <h3>得点 / 交代</h3>
    <p>得点：前半3分#3澁澤光、前半6分#16端山新、後半23分オウンゴール</p>
  `;

  assert.deepEqual(parseReportedGoals(html), [
    { minute: "3分", playerNumber: 3, playerName: "澁澤光" },
    { minute: "6分", playerNumber: 16, playerName: "端山新" },
    { minute: "63分", playerNumber: null, playerName: "オウンゴール" },
  ]);
});

test("parseReportedGoals: 時刻のない得点者一覧も人数検証用に抽出する", () => {
  assert.deepEqual(
    parseReportedGoals("<p>得点：#3澁澤光、#平良文果、オウンゴール</p>"),
    [
      { minute: "時間不明", playerNumber: 3, playerName: "澁澤光" },
      { minute: "時間不明", playerNumber: null, playerName: "平良文果" },
      { minute: "時間不明", playerNumber: null, playerName: "オウンゴール" },
    ],
  );
});

test("parseReportedGoals: 得点者の回数表記を得点イベントへ展開する", () => {
  assert.deepEqual(
    parseReportedGoals("<p>得点：#9小山莉奈×2、福井真歩</p>"),
    [
      { minute: "時間不明", playerNumber: 9, playerName: "小山莉奈" },
      { minute: "時間不明", playerNumber: 9, playerName: "小山莉奈" },
      { minute: "時間不明", playerNumber: null, playerName: "福井真歩" },
    ],
  );
});

test("parseReportedGoals: 区切りなしで連結された背番号から得点者を分ける", () => {
  assert.deepEqual(
    parseReportedGoals("<p>得点：＃8野沢真由#13原日樺</p>"),
    [
      { minute: "時間不明", playerNumber: 8, playerName: "野沢真由" },
      { minute: "時間不明", playerNumber: 13, playerName: "原日樺" },
    ],
  );
});
