import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  enrichMatchesWithSchedule,
  parseGoalNoteGame,
  parseGoalNoteSchedule,
  parseScorerRanking,
} from "../src/lib/goalnote-parser.js";

const scheduleFix = readFileSync(
  fileURLToPath(new URL("./fixtures/goalnote-schedule.html", import.meta.url)),
  "utf-8",
);
const gameFix = readFileSync(
  fileURLToPath(new URL("./fixtures/goalnote-game.html", import.meta.url)),
  "utf-8",
);

test("parseGoalNoteSchedule: 全試合行を抽出し会場が含まれる", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  assert.ok(rows.length >= 40, `行数 ${rows.length}`);
  const anclas = rows.filter((r) => r.homeTeam.includes("アンクラス") || r.awayTeam.includes("アンクラス"));
  assert.ok(anclas.length >= 10, `アンクラス行 ${anclas.length}`);
  const withVenue = rows.filter((r) => r.venue);
  assert.ok(withVenue.length > rows.length * 0.5, "半数以上の行に会場がある");
  const withUrl = rows.filter((r) => r.gameUrl);
  assert.ok(withUrl.length > 0, "game URL がある行が存在する");
});

test("enrichMatchesWithSchedule: 日付+チーム名で会場を補完", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  const matches = [
    {
      date: "2026-04-12",
      homeTeam: "福岡J・アンクラス",
      awayTeam: "ヴィアマテラス宮崎Alegrita",
      venue: null as string | null,
      goalnoteUrl: null as string | null,
      status: "scheduled" as "scheduled" | "finished",
      score: null as { home: number; away: number } | null,
    },
  ];
  enrichMatchesWithSchedule(matches, rows);
  assert.ok(matches[0]!.venue, "会場が補完された");
  assert.ok(matches[0]!.goalnoteUrl, "game URL が補完された");
});

test("enrichMatchesWithSchedule: 別表記のホームチームでも突き合わせる", () => {
  // GoalNote と q-league でホームチームの書き方が違っても、別名表で代表名へ寄せて照合する
  const rows = [
    {
      date: "2026-05-24",
      kickoff: "12:00",
      homeTeam: "柳ヶ浦高校女子サッカー部",
      awayTeam: "福岡J・アンクラス",
      venue: "柳ヶ浦高校グラウンド",
      gameUrl: "https://www.goalnote.net/detail-schedule-game.php?tid=1&sid=2",
      score: null as { home: number; away: number } | null,
    },
  ];
  const matches = [
    {
      date: "2026-05-24",
      homeTeam: "柳ヶ浦高等学校　女子サッカー部",
      awayTeam: "福岡J・アンクラス",
      venue: null as string | null,
      goalnoteUrl: null as string | null,
      status: "scheduled" as "scheduled" | "finished",
      score: null as { home: number; away: number } | null,
    },
  ];

  enrichMatchesWithSchedule(matches, rows);

  assert.equal(matches[0]!.venue, "柳ヶ浦高校グラウンド");
  assert.ok(matches[0]!.goalnoteUrl, "game URL が補完された");
});

test("parseGoalNoteGame: 得点経過を抽出", () => {
  const data = parseGoalNoteGame(gameFix, "福岡J・アンクラス");
  assert.ok(data.goals.length >= 3, `ゴール数 ${data.goals.length}`);
  const og = data.goals.find((g) => g.playerName.includes("オウンゴール"));
  assert.ok(og, "オウンゴールが含まれる");
  assert.equal(og?.playerNumber, null);
  const kakazu = data.goals.find((g) => g.playerName.includes("嘉数"));
  assert.ok(kakazu, "嘉数 クレア姫麗のゴールが含まれる");
  assert.equal(kakazu?.playerNumber, 11);
});

test("parseGoalNoteGame: 得点経過がない旧形式では左右の得点表を抽出する", () => {
  const html = `
    <th class="score-team1">神村学園高等部<div>KICK OFF</div></th>
    <th class="score-team2">福岡J・アンクラス<div>&nbsp;</div></th>
    <td class="scorer">
      <table class="list-table">
        <tr><td colspan="2">前半</td></tr>
        <tr><td>45</td><td>坂元 めい (1-0)</td></tr>
      </table>
    </td>
    <td class="scorer score-label">得点</td>
    <td class="scorer">
      <table class="list-table">
        <tr><td colspan="2">59分(後半19分)</td></tr>
        <tr><td>3</td><td>澁澤 光 (1-1)</td></tr>
        <tr><td colspan="2">後半</td></tr>
        <tr><td>23</td><td>北条 あゆみ (1-2)</td></tr>
      </table>
    </td>
  `;

  assert.deepEqual(parseGoalNoteGame(html, "神村学園高等部").goals, [
    {
      minute: "前半",
      team: "神村学園高等部",
      playerNumber: 45,
      playerName: "坂元 めい",
      assist: null,
    },
    {
      minute: "59分(後半19分)",
      team: "福岡J・アンクラス",
      playerNumber: 3,
      playerName: "澁澤 光",
      assist: null,
    },
    {
      minute: "後半",
      team: "福岡J・アンクラス",
      playerNumber: 23,
      playerName: "北条 あゆみ",
      assist: null,
    },
  ]);
});

test("parseGoalNoteGame: スタメン（ポジション付き）を抽出", () => {
  const data = parseGoalNoteGame(gameFix, "福岡J・アンクラス");
  assert.ok(data.starters.length >= 20, `スタメン ${data.starters.length}`);
  const homeStarters = data.starters.filter((p) => p.team === "home");
  assert.equal(homeStarters.length, 11, "ホームスタメン11人");
  const gk = homeStarters.find((p) => p.position === "GK");
  assert.ok(gk, "GK がいる");
  assert.equal(gk?.name, "釜坂 慧");
  const fw = homeStarters.filter((p) => p.position === "FW");
  assert.ok(fw.length >= 2, "FW が2人以上");
});

test("parseGoalNoteGame: 旧形式の出場区分列から先発と控えを分ける", () => {
  const html = `
    <div class="score-team1">福岡大学サッカー部女子</div>
    <table>
      <tr><td>1</td><td>GK</td><td>○</td><td>三宅 未紗</td></tr>
      <tr><td>16</td><td>FW</td><td>△</td><td>古村 誉</td></tr>
      <tr><td>18</td><td>MF</td><td></td><td>吉武 春歌</td></tr>
    </table>
    <table>
      <tr><td>1</td><td>GK</td><td>○</td><td>釜坂 慧</td></tr>
      <tr><td>19</td><td>DF</td><td>○</td><td>平坂 咲希 (Cap.)</td></tr>
      <tr><td>21</td><td>GK</td><td>△</td><td>進藤 真奈花</td></tr>
    </table>
  `;
  const parsed = parseGoalNoteGame(html, "福岡大学サッカー部女子");
  assert.deepEqual(parsed.starters.map((player) => player.name), [
    "三宅 未紗",
    "釜坂 慧",
    "平坂 咲希",
  ]);
  assert.deepEqual(parsed.subs.map((player) => player.name), [
    "古村 誉",
    "吉武 春歌",
    "進藤 真奈花",
  ]);
});

test("parseGoalNoteGame: 交代表が片側だけでも選手名から所属チームを判定する", () => {
  const html = `
    <div class="score-team1">ホームFC</div>
    <table>
      <tr><td>1</td><td>GK</td><td>○</td><td>ホーム 選手</td></tr>
      <tr><td>12</td><td>GK</td><td>△</td><td>ホーム 控え</td></tr>
    </table>
    <table>
      <tr><td>23</td><td>DF</td><td>○</td><td>北条 あゆみ</td></tr>
      <tr><td>25</td><td>MF</td><td>△</td><td>伊藤 なずな</td></tr>
    </table>
    <table>
      <tr><td>ＨＴ</td></tr>
      <tr>
        <td>23</td><td>北条 あゆみ</td>
        <th class="change"></th>
        <td>25</td><td>伊藤 なずな</td>
      </tr>
    </table>
  `;

  assert.deepEqual(parseGoalNoteGame(html, "ホームFC").substitutions, [
    {
      minute: "ＨＴ",
      team: "away",
      outNumber: 23,
      outName: "北条 あゆみ",
      inNumber: 25,
      inName: "伊藤 なずな",
    },
  ]);
});

test("parseGoalNoteGame: 警告（イエローカード）を抽出", () => {
  const data = parseGoalNoteGame(gameFix, "福岡J・アンクラス");
  // fixture には田中花奈・森和奏のラフ（警告）が含まれる
  assert.ok(data.cards.length >= 2, `カード数 ${data.cards.length}`);
  const tanaka = data.cards.find((c) => c.name.includes("田中"));
  assert.ok(tanaka, "田中のカードがある");
  assert.equal(tanaka?.type, "yellow");
});

const rankingFix = readFileSync(
  fileURLToPath(new URL("./fixtures/goalnote-ranking.html", import.meta.url)),
  "utf-8",
);

test("parseScorerRanking: アンクラス選手のみ抽出し背番号を補完", () => {
  const numberByName = new Map<string, number>([
    ["嘉数クレア姫麗", 11],
    ["原日樺", 13],
  ]);
  const scorers = parseScorerRanking(rankingFix, numberByName);

  assert.ok(scorers.length >= 2, `アンクラス選手 ${scorers.length}人`);
  assert.ok(
    scorers.every((s) => s.goals > 0),
    "全員 goals > 0",
  );

  const kakazu = scorers.find((s) => s.name.includes("嘉数"));
  assert.ok(kakazu, "嘉数がいる");
  assert.equal(kakazu?.number, 11, "背番号がマップから補完される");
  assert.equal(kakazu?.leagueRank, 2, "リーグ順位は原典のまま");

  // マップに無い選手は number: null
  const unmapped = scorers.find((s) => !s.name.includes("嘉数") && !s.name.includes("原"));
  if (unmapped) assert.equal(unmapped.number, null, "未登録選手は null");
});

test("parseScorerRanking: チーム内順位は得点降順・同点同順位で振り直す", () => {
  const scorers = parseScorerRanking(rankingFix, new Map());
  // 得点が降順に並んでいる
  for (let i = 1; i < scorers.length; i++) {
    assert.ok(scorers[i - 1]!.goals >= scorers[i]!.goals, "得点降順");
  }
  // 先頭はチーム内1位
  assert.equal(scorers[0]?.rank, 1, "先頭はチーム1位");
  // 同点は同順位、次の順位は人数分飛ぶ（1,1,3 形式）
  for (let i = 1; i < scorers.length; i++) {
    const prev = scorers[i - 1]!;
    const cur = scorers[i]!;
    if (cur.goals === prev.goals) {
      assert.equal(cur.rank, prev.rank, "同点は同順位");
    } else {
      assert.equal(cur.rank, i + 1, "順位は人数分飛ぶ");
    }
  }
});

test("enrichMatchesWithSchedule: q-league未消化でもGoalNoteに結果があれば確定に昇格", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  const matches = [
    {
      date: "2026-04-12",
      homeTeam: "福岡J・アンクラス",
      awayTeam: "ヴィアマテラス宮崎Alegrita",
      venue: null as string | null,
      goalnoteUrl: null as string | null,
      status: "scheduled" as "scheduled" | "finished",
      score: null as { home: number; away: number } | null,
    },
  ];
  enrichMatchesWithSchedule(matches, rows);
  assert.equal(matches[0]!.status, "finished", "finished に昇格");
  assert.deepEqual(matches[0]!.score, { home: 2, away: 2 }, "GoalNote のスコアが入る");
});

test("enrichMatchesWithSchedule: 既にfinishedの試合のスコアは上書きしない", () => {
  const rows = parseGoalNoteSchedule(scheduleFix);
  const matches = [
    {
      date: "2026-04-12",
      homeTeam: "福岡J・アンクラス",
      awayTeam: "ヴィアマテラス宮崎Alegrita",
      venue: null as string | null,
      goalnoteUrl: null as string | null,
      status: "finished" as "scheduled" | "finished",
      score: { home: 9, away: 9 } as { home: number; away: number } | null,
    },
  ];
  enrichMatchesWithSchedule(matches, rows);
  assert.deepEqual(matches[0]!.score, { home: 9, away: 9 }, "q-league確定値を維持");
});
