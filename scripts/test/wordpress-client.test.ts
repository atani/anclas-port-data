import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRescheduleInfo,
  parseAnnouncementDateTime,
  parseAnnouncementVenue,
  parsePlayerArchiveUrl,
  parsePublishedPlayerUrls,
  parseReportedGoals,
} from "../src/lib/wordpress-client.js";

test("parsePlayerArchiveUrl: グローバルメニューから選手一覧URLを取得する", () => {
  const html = '<a href="/category/top-players2025/">TOP選手紹介</a>';
  assert.equal(parsePlayerArchiveUrl(html), "https://anclas.jp/category/top-players2025/");
});

test("parsePublishedPlayerUrls: 一覧カードの公開選手URLを重複なく取得する", () => {
  const html = `
    <article><a class="wrap-anchor" href="https://anclas.jp/post-1/?ref=list">選手1</a></article>
    <article><a href="/post-2/" class="wrap-anchor other">選手2</a></article>
    <article><a class="wrap-anchor" href="https://anclas.jp/post-1/">選手1</a></article>
  `;
  assert.deepEqual(parsePublishedPlayerUrls(html), [
    "https://anclas.jp/post-1/",
    "https://anclas.jp/post-2/",
  ]);
});

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

test("parseAnnouncementDateTime: 代替試合情報の告知本文から日付とキックオフ時刻を抽出する", () => {
  const text = "相　　手：国見FCレディース\n日　　時：2026年9月5日(日)18：00 キックオフ\n会　　場：Arrivo!南島原";
  assert.deepEqual(parseAnnouncementDateTime(text), { date: "2026-09-05", kickoff: "18:00" });
});

test("parseAnnouncementDateTime: 半角コロン・一桁の日付にも対応する", () => {
  const text = "日時：2026年9月5日(日)9:05 キックオフ";
  assert.deepEqual(parseAnnouncementDateTime(text), { date: "2026-09-05", kickoff: "09:05" });
});

test("parseAnnouncementDateTime: 日時の記載が無ければ null を返す", () => {
  assert.equal(parseAnnouncementDateTime("相　　手：国見FCレディース"), null);
});

test("parseAnnouncementVenue: 住所（〈〉以降）を含めず会場名だけを抽出する", () => {
  const text = "会　　場：Arrivo!南島原(南島原多目的運動広場)〈長崎県南島原市南有馬町丁５０８〉";
  assert.equal(parseAnnouncementVenue(text), "Arrivo!南島原(南島原多目的運動広場)");
});

test("parseAnnouncementVenue: 会場の記載が無ければ null を返す", () => {
  assert.equal(parseAnnouncementVenue("相　　手：国見FCレディース"), null);
});

// 実在する旧書式（【代替試合について】投稿）: ラベルと値が別行で、数字の前後にスペースが入る
test("parseAnnouncementDateTime: ラベルと値が別行・数字前後にスペースがある旧書式にも対応する", () => {
  const text = "日時\n2026 年 7 月 12 日 (日)　16：00キックオフ";
  assert.deepEqual(parseAnnouncementDateTime(text), { date: "2026-07-12", kickoff: "16:00" });
});

test("parseAnnouncementVenue: 「試合会場」ラベル・別行書式にも対応する", () => {
  const text = "試合会場\nエコパーク水俣 陸上競技場（熊本県水俣市汐見町1丁目231-12）\n≪アクセス≫";
  assert.equal(parseAnnouncementVenue(text), "エコパーク水俣 陸上競技場（熊本県水俣市汐見町1丁目231-12）");
});

test("applyRescheduleInfo: 日付またはキックオフが変われば試合データへ反映しtrueを返す", () => {
  const m = { date: "2026-07-05", kickoff: "13:00", datetime: "2026-07-05T13:00:00+09:00", venue: null };
  const info = { date: "2026-09-05", kickoff: "18:00", venue: "Arrivo!南島原", sourceUrl: "https://anclas.jp/post-27898/" };
  const updated = applyRescheduleInfo(m, info);
  assert.equal(updated, true);
  assert.deepEqual(m, {
    date: "2026-09-05",
    kickoff: "18:00",
    datetime: "2026-09-05T18:00:00+09:00",
    venue: "Arrivo!南島原",
  });
});

test("applyRescheduleInfo: 日付・キックオフとも変化が無ければ何もせずfalseを返す", () => {
  const m = { date: "2026-09-05", kickoff: "18:00", datetime: "2026-09-05T18:00:00+09:00", venue: "旧会場" };
  const info = { date: "2026-09-05", kickoff: "18:00", venue: "新会場", sourceUrl: "https://anclas.jp/post-27898/" };
  const updated = applyRescheduleInfo(m, info);
  assert.equal(updated, false);
  assert.equal(m.venue, "旧会場");
});

test("applyRescheduleInfo: 日付は同じでキックオフだけ変わった場合も反映する", () => {
  const m = { date: "2026-09-05", kickoff: "13:00", datetime: "2026-09-05T13:00:00+09:00", venue: null };
  const info = { date: "2026-09-05", kickoff: "18:00", venue: null, sourceUrl: "https://anclas.jp/post-27898/" };
  const updated = applyRescheduleInfo(m, info);
  assert.equal(updated, true);
  assert.equal(m.kickoff, "18:00");
});
