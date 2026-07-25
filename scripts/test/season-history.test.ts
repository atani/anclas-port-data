import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHistoryData,
  buildPlayerIdentities,
  normalizeTeamName,
  parseNadeshikoMatch,
  type NadeshikoMatchDetail,
} from "../src/lib/season-history.js";
import { ANCLAS_TEAM_NAME, type Match, type SeasonHistory } from "../src/lib/types.js";

function nadeshikoFixture(): NadeshikoMatchDetail {
  const member = (number: number, name: string, last = false) => ({
    position: number === 1 ? "GK" : "MF",
    uniformNumber: String(number),
    startLastMember: last ? "1" : "",
    personName: name,
  });
  return {
    matchDetail: {
      competitionName: "2024プレナスなでしこリーグ2部",
      matchTypeName: "第1節",
      matchNumber: "2",
      matchDate: "2024/03/16",
      matchTime: "13:00",
      matchStatus: "公式記録済",
      venueFullName: "テスト競技場",
      attendance: "100人",
      weather: "晴",
      homeTeamDetail: {
        teamName: "対戦相手",
        totalScore: "0",
        teamMemberList: {
          teamMember: [member(1, "相手 一"), member(2, "相手 二", true), member(3, "相手 控え")],
        },
      },
      awayTeamDetail: {
        teamName: "福岡Ｊ・アンクラス",
        totalScore: "2",
        scorerList: { scorer: [{ scorerName: "10分 選手　一" }, { scorerName: "20分 選手　二" }] },
        teamMemberList: {
          teamMember: [member(1, "選手　一"), member(2, "選手　二", true), member(3, "控え　のみ")],
        },
        substituteList: {
          substitute: [{
            substituteTime: "60分",
            outPerson: { uniformNumber: "2", personName: "選手　二" },
            inPerson: { uniformNumber: "4", personName: "途中　出場" },
          }],
        },
      },
    },
  };
}

test("normalizeTeamName: 取得元が違っても同じ代表名へ寄せる", () => {
  // GoalNote は「柳ヶ浦高校」、q-league は「柳ヶ浦高等学校　」と書く。
  // ここが分かれると過去の対戦成績が引けなくなる。
  assert.equal(
    normalizeTeamName("柳ヶ浦高校女子サッカー部"),
    normalizeTeamName("柳ヶ浦高等学校　女子サッカー部"),
  );
  assert.equal(normalizeTeamName("福岡Ｊ・アンクラス"), ANCLAS_TEAM_NAME);
});

test("normalizeTeamName: 全角スペースを保ったまま互換文字を畳む", () => {
  assert.equal(normalizeTeamName("ﾃﾞｨｵｯｻ出雲FC"), "ディオッサ出雲FC");
  // 別名表に載っていない名前は、取得元の空白表記をそのまま保つ
  // （別名表に載っている名前だと代表名が返るため、空白の保護を検証できない）
  assert.equal(
    normalizeTeamName("秀岳館高等学校　女子サッカー部"),
    "秀岳館高等学校　女子サッカー部",
  );
});

test("なでしこJSONのstartLastMemberで先発と控えを分ける", () => {
  const match = parseNadeshikoMatch(2024, nadeshikoFixture());
  assert.equal(match.round, 1);
  assert.deepEqual(
    match.starters.filter((player) => player.team === "away").map((player) => player.name),
    ["選手 一", "選手 二"],
  );
  assert.deepEqual(
    match.subs.filter((player) => player.team === "away").map((player) => player.name),
    ["控え のみ"],
  );
});

test("控え登録だけは出場に数えず、途中出場は数える", () => {
  const match = parseNadeshikoMatch(2024, nadeshikoFixture());
  const season: SeasonHistory = {
    year: 2024,
    competition: match.competition,
    sourceType: "nadeshiko-json",
    sourceUrl: match.sourceUrl,
    matches: [match],
  };
  const identities = buildPlayerIdentities([
    { name: "選手 一", birthDate: "2000-01-01" },
    { name: "選手 二", birthDate: "2000-02-02" },
    { name: "控え のみ", birthDate: "2000-03-03" },
    { name: "途中 出場", birthDate: "2000-04-04" },
  ]);
  const history = buildHistoryData([season], identities, "2026-01-01T00:00:00Z");
  const byName = new Map(history.players.map((player) => [player.displayName, player]));
  assert.equal(byName.get("選手 一")?.clubLeagueAppearances, 1);
  assert.equal(byName.get("選手 二")?.clubLeagueAppearances, 1);
  assert.equal(byName.get("途中 出場")?.clubLeagueAppearances, 1);
  assert.equal(byName.has("控え のみ"), false);
  assert.equal(byName.get("選手 一")?.clubLeagueGoals, 1);
});

test("同名で生年月日が異なる選手は自動照合しない", () => {
  const identities = buildPlayerIdentities([
    { name: "同姓 同名", birthDate: "2000-01-01" },
    { name: "同姓同名", birthDate: "2001-01-01" },
  ]);
  assert.equal(identities.has("同姓同名"), false);
});

test("初出場・初先発・初ゴールは日時順の最初の試合を採用する", () => {
  const base = parseNadeshikoMatch(2024, nadeshikoFixture());
  const later: Match = {
    ...base,
    id: "later",
    date: "2024-04-01",
    datetime: "2024-04-01T13:00:00+09:00",
  };
  const season: SeasonHistory = {
    year: 2024,
    competition: base.competition,
    sourceType: "nadeshiko-json",
    sourceUrl: base.sourceUrl,
    matches: [later, base],
  };
  const history = buildHistoryData(
    [season],
    buildPlayerIdentities([{ name: "選手 一", birthDate: "2000-01-01" }]),
  );
  const player = history.players[0]!;
  assert.equal(player.firstAppearance?.matchId, base.id);
  assert.equal(player.firstStart?.matchId, base.id);
  assert.equal(player.firstGoal?.matchId, base.id);
});

test("取得開始年から在籍する選手には誤った初記録を付けない", () => {
  const match = {
    ...parseNadeshikoMatch(2024, nadeshikoFixture()),
    season: "2021",
    date: "2021-05-01",
    datetime: "2021-05-01T13:00:00+09:00",
  };
  const history = buildHistoryData(
    [{
      year: 2021,
      competition: match.competition,
      sourceType: "nadeshiko-json",
      sourceUrl: match.sourceUrl,
      matches: [match],
    }],
    buildPlayerIdentities([{ name: "選手 一", birthDate: "2000-01-01" }]),
  );
  assert.equal(history.players[0]?.firstAppearance, null);
  assert.equal(history.players[0]?.firstStart, null);
  assert.equal(history.players[0]?.firstGoal, null);
});

test("生年月日を確認できない選手には初記録を付けない", () => {
  const match = parseNadeshikoMatch(2024, nadeshikoFixture());
  const history = buildHistoryData(
    [{
      year: 2024,
      competition: match.competition,
      sourceType: "nadeshiko-json",
      sourceUrl: match.sourceUrl,
      matches: [match],
    }],
    buildPlayerIdentities([{ name: "選手 一", birthDate: null }]),
  );
  assert.equal(history.players[0]?.identityStatus, "name-only");
  assert.equal(history.players[0]?.firstAppearance, null);
  assert.equal(history.players[0]?.firstStart, null);
  assert.equal(history.players[0]?.firstGoal, null);
});
