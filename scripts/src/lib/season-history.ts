import { logger } from "./logger.js";
import { normalizeTeamName as normalizeQLeagueTeamName } from "./qleague-parser.js";
import {
  ANCLAS_TEAM_NAME,
  type GoalEvent,
  type HistoryData,
  type Match,
  type MatchPlayer,
  type PlayerLeagueHistory,
  type PlayerMilestone,
  type PlayerSeasonRecord,
  type Position,
  type SeasonHistory,
  type Substitution,
} from "./types.js";

const POSITION_VALUES = new Set<Position>(["GK", "DF", "MF", "FW", "FP"]);
const HISTORY_START_YEAR = 2021;

export interface NadeshikoSchedule {
  matchScheduleList: {
    competitionName: string;
    matchSchedule: NadeshikoScheduleRow[];
  };
}

export interface NadeshikoScheduleRow {
  matchTypeName: string;
  matchNumber: string;
  matchDate: string;
  matchTime: string;
  venueFullName: string;
  homeTeamName: string;
  homeTeamNo: string;
  awayTeamName: string;
  awayTeamNo: string;
  score: { homeScore: string; awayScore: string } | null;
  matchStatus: string;
}

interface NadeshikoMember {
  position: string;
  uniformNumber: string;
  startLastMember?: string;
  personName: string;
}

interface NadeshikoSubstitution {
  substituteTime: string;
  outPerson: { uniformNumber: string; personName: string };
  inPerson: { uniformNumber: string; personName: string };
}

interface NadeshikoTeamDetail {
  teamName: string;
  totalScore: string;
  scorerList?: { scorer?: Array<{ scorerName: string }> };
  teamMemberList?: { teamMember?: NadeshikoArray<NadeshikoMember> };
  substituteList?: { substitute?: NadeshikoArray<NadeshikoSubstitution> };
}

type NadeshikoArray<T> = T[] | T;

export interface NadeshikoMatchDetail {
  matchDetail: {
    competitionName: string;
    matchTypeName: string;
    matchNumber: string;
    matchDate: string;
    matchTime: string;
    matchStatus: string;
    venueFullName: string;
    attendance?: string;
    weather?: string;
    homeTeamDetail: NadeshikoTeamDetail;
    awayTeamDetail: NadeshikoTeamDetail;
  };
}

export interface HistoricalRosterMember {
  personName: string;
  birthdayDate: string;
  uniformNumber: string;
}

export interface HistoricalRoster {
  teamMemberList: {
    teamMember: NadeshikoArray<HistoricalRosterMember>;
  };
}

export interface IdentitySeed {
  name: string;
  birthDate: string | null;
  aliases?: string[];
}

export interface PlayerIdentity {
  playerId: string;
  displayName: string;
  birthDate: string | null;
  aliases: string[];
  identityStatus: "verified" | "name-only";
}

export function asArray<T>(value: NadeshikoArray<T> | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizePlayerName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s|\u3000/g, "")
    .replace(/\(Cap\.\)/gi, "")
    .trim();
}

/**
 * 半角カナや互換文字を NFKC で畳む。ただし NFKC は全角スペースを半角へ変えてしまい、
 * 代表名の空白表記が取得元ごとにずれるため、全角スペースは区切って保護する。
 */
function foldCompatibilityForms(value: string): string {
  return value
    .split("\u3000")
    .map((part) => part.normalize("NFKC"))
    .join("\u3000");
}

/**
 * チーム名を代表名へ寄せる。別名表は qleague-parser の TEAM_ALIASES が正本で、
 * ここは互換文字を畳んでから委譲するだけにする。
 * 自クラブだけは表記が多いため、別名表に載せず部分一致で吸収する。
 */
export function normalizeTeamName(value: string): string {
  const folded = foldCompatibilityForms(value);
  if (folded.replace(/\s|\u3000/g, "").includes("アンクラス")) {
    return ANCLAS_TEAM_NAME;
  }
  return normalizeQLeagueTeamName(folded);
}

function isoDate(value: string): string {
  return value.replaceAll("/", "-");
}

function roundNumber(label: string): number | null {
  const match = label.match(/第(\d+)節/);
  return match ? Number(match[1]) : null;
}

function position(value: string): Position {
  const normalized = value.toUpperCase() as Position;
  return POSITION_VALUES.has(normalized) ? normalized : "FP";
}

function cleanPersonName(value: string): string {
  return value.replace(/\s*\(Cap\.\)/gi, "").replace(/\s+/g, " ").trim();
}

function splitMembers(team: "home" | "away", members: NadeshikoMember[]): {
  starters: MatchPlayer[];
  subs: MatchPlayer[];
} {
  const mapped = members.map((member) => ({
    number: Number(member.uniformNumber),
    position: position(member.position),
    name: cleanPersonName(member.personName),
    team,
  }));
  const marker = members.findIndex((member) => member.startLastMember === "1");
  const starterCount = marker >= 0 ? marker + 1 : Math.min(11, mapped.length);
  return {
    starters: mapped.slice(0, starterCount),
    subs: mapped.slice(starterCount),
  };
}

function substitutions(
  team: "home" | "away",
  values: NadeshikoArray<NadeshikoSubstitution> | undefined,
): Substitution[] {
  return asArray(values).map((item) => ({
    minute: item.substituteTime,
    team,
    outNumber: Number(item.outPerson.uniformNumber),
    outName: cleanPersonName(item.outPerson.personName),
    inNumber: Number(item.inPerson.uniformNumber),
    inName: cleanPersonName(item.inPerson.personName),
  }));
}

function goals(team: NadeshikoTeamDetail): GoalEvent[] {
  return asArray(team.scorerList?.scorer).flatMap((item) => {
    const match = item.scorerName.match(/^(.+?分)\s+(.+)$/);
    if (!match) return [];
    return [{
      minute: match[1]!,
      team: normalizeTeamName(team.teamName),
      playerNumber: null,
      playerName: cleanPersonName(match[2]!),
      assist: null,
    }];
  });
}

export function parseNadeshikoMatch(year: number, payload: NadeshikoMatchDetail): Match {
  const detail = payload.matchDetail;
  const homeTeam = normalizeTeamName(detail.homeTeamDetail.teamName);
  const awayTeam = normalizeTeamName(detail.awayTeamDetail.teamName);
  const home = splitMembers("home", asArray(detail.homeTeamDetail.teamMemberList?.teamMember));
  const away = splitMembers("away", asArray(detail.awayTeamDetail.teamMemberList?.teamMember));
  const date = isoDate(detail.matchDate);
  const matchNumber = detail.matchNumber;
  const sourceUrl =
    `https://match.nadeshikoleague.jp/${year}/nadeshiko2/match_page/m${matchNumber}.json`;

  return {
    id: `nadeshiko-${year}-m${matchNumber}`,
    season: String(year),
    competition: detail.competitionName,
    round: roundNumber(detail.matchTypeName),
    date,
    kickoff: detail.matchTime || null,
    datetime: `${date}T${detail.matchTime || "00:00"}:00+09:00`,
    homeTeam,
    awayTeam,
    status: "finished",
    score: {
      home: Number(detail.homeTeamDetail.totalScore),
      away: Number(detail.awayTeamDetail.totalScore),
    },
    isAnclas: homeTeam === ANCLAS_TEAM_NAME || awayTeam === ANCLAS_TEAM_NAME,
    sourceUrl,
    venue: detail.venueFullName || null,
    goals: [...goals(detail.homeTeamDetail), ...goals(detail.awayTeamDetail)],
    starters: [...home.starters, ...away.starters],
    subs: [...home.subs, ...away.subs],
    substitutions: [
      ...substitutions("home", detail.homeTeamDetail.substituteList?.substitute),
      ...substitutions("away", detail.awayTeamDetail.substituteList?.substitute),
    ],
    stats: {
      attendance: detail.attendance || null,
      weather: detail.weather || null,
      temperature: null,
      pitch: null,
    },
    goalnoteUrl: null,
    posterUrl: null,
    matchdayProgramUrl: null,
    cards: [],
    matchReport: null,
    photoGallery: [],
    forecast: null,
  };
}

export function buildPlayerIdentities(seeds: IdentitySeed[]): Map<string, PlayerIdentity> {
  const groups = new Map<string, IdentitySeed[]>();
  for (const seed of seeds) {
    const names = [seed.name, ...(seed.aliases ?? [])];
    for (const name of names) {
      const key = normalizePlayerName(name);
      const list = groups.get(key) ?? [];
      if (!list.some((item) => item.birthDate === seed.birthDate && item.name === seed.name)) {
        list.push(seed);
      }
      groups.set(key, list);
    }
  }

  const result = new Map<string, PlayerIdentity>();
  for (const [key, candidates] of groups) {
    const birthDates = new Set(
      candidates
        .map((item) => item.birthDate)
        .filter((birthDate): birthDate is string => birthDate !== null),
    );
    if (birthDates.size > 1) {
      // 同姓同名の別人か、取得元での生年月日の誤りかを区別できないため記録を作らない。
      // 別人なら取得元の表記で区別する、同一人物なら取得元の誤りを直す、のどちらかが要る。
      // 生年月日は公開ログに残さず、切り分けに要る年だけ出す。
      const years = [...birthDates].map((date) => date.slice(0, 4));
      logger.warn(
        `${key}: 生年月日が一致せず履歴から除外（${birthDates.size}件 / 生年 ${years.join(" ")}）`,
      );
      continue;
    }
    const seed = candidates.find((item) => item.birthDate) ?? candidates[0];
    if (!seed) continue;
    const birthDate = seed.birthDate;
    const aliases = [...new Set(candidates.flatMap((item) => [item.name, ...(item.aliases ?? [])]))];
    result.set(key, {
      playerId: birthDate
        ? `anclas-${birthDate.replaceAll("-", "")}-${normalizePlayerName(seed.name)}`
        : `anclas-name-${normalizePlayerName(seed.name)}`,
      displayName: seed.name,
      birthDate,
      aliases,
      identityStatus: birthDate ? "verified" : "name-only",
    });
  }
  return result;
}

function milestone(match: Match): PlayerMilestone {
  return {
    matchId: match.id,
    season: Number(match.season ?? match.date.slice(0, 4)),
    date: match.date,
    opponent: match.homeTeam === ANCLAS_TEAM_NAME ? match.awayTeam : match.homeTeam,
    round: match.round,
  };
}

export function buildPlayerLeagueHistory(
  seasons: SeasonHistory[],
  identities: Map<string, PlayerIdentity>,
): PlayerLeagueHistory[] {
  interface MutableRecord {
    identity: PlayerIdentity;
    seasons: Map<number, PlayerSeasonRecord>;
    firstAppearance: PlayerMilestone | null;
    firstStart: PlayerMilestone | null;
    firstGoal: PlayerMilestone | null;
  }

  const records = new Map<string, MutableRecord>();
  const getRecord = (name: string): MutableRecord | null => {
    const identity = identities.get(normalizePlayerName(name));
    if (!identity) return null;
    let record = records.get(identity.playerId);
    if (!record) {
      record = {
        identity,
        seasons: new Map(),
        firstAppearance: null,
        firstStart: null,
        firstGoal: null,
      };
      records.set(identity.playerId, record);
    }
    return record;
  };

  const orderedMatches = seasons
    .flatMap((season) => season.matches)
    .filter((match) => match.isAnclas && match.status === "finished")
    .sort((a, b) => a.datetime.localeCompare(b.datetime));

  for (const match of orderedMatches) {
    const season = Number(match.season ?? match.date.slice(0, 4));
    const side: "home" | "away" = match.homeTeam === ANCLAS_TEAM_NAME ? "home" : "away";
    const starters = match.starters.filter((player) => player.team === side);
    const enteredNames = new Set(
      match.substitutions
        .filter((event) => event.team === side)
        .map((event) => normalizePlayerName(event.inName)),
    );
    const appearanceNames = new Set([
      ...starters.map((player) => normalizePlayerName(player.name)),
      ...enteredNames,
    ]);

    for (const name of appearanceNames) {
      const record = getRecord(name);
      if (!record) continue;
      const seasonRecord = record.seasons.get(season) ?? { season, appearances: 0, starts: 0, goals: 0 };
      seasonRecord.appearances++;
      record.seasons.set(season, seasonRecord);
      record.firstAppearance ??= milestone(match);
    }
    for (const player of starters) {
      const record = getRecord(player.name);
      if (!record) continue;
      const seasonRecord = record.seasons.get(season) ?? { season, appearances: 0, starts: 0, goals: 0 };
      seasonRecord.starts++;
      record.seasons.set(season, seasonRecord);
      record.firstStart ??= milestone(match);
    }
    for (const goal of match.goals) {
      if (normalizeTeamName(goal.team) !== ANCLAS_TEAM_NAME || /オウンゴール/.test(goal.playerName)) continue;
      const record = getRecord(goal.playerName);
      if (!record) continue;
      const seasonRecord = record.seasons.get(season) ?? { season, appearances: 0, starts: 0, goals: 0 };
      seasonRecord.goals++;
      record.seasons.set(season, seasonRecord);
      record.firstGoal ??= milestone(match);
    }
  }

  return [...records.values()]
    .map((record) => {
      const seasonRecords = [...record.seasons.values()].sort((a, b) => b.season - a.season);
      // 取得開始年より前の在籍記録は持っていない。2021年の時点ですでに出場している選手へ
      // 誤った「アンクラスでの初」を付けないよう、最古年に登場する選手の節目は未確認とする。
      const milestonesVerified =
        record.identity.identityStatus === "verified" &&
        record.firstAppearance?.season !== HISTORY_START_YEAR;
      return {
        playerId: record.identity.playerId,
        displayName: record.identity.displayName,
        birthDate: record.identity.birthDate,
        aliases: record.identity.aliases,
        identityStatus: record.identity.identityStatus,
        seasons: seasonRecords,
        clubLeagueAppearances: seasonRecords.reduce((sum, item) => sum + item.appearances, 0),
        clubLeagueStarts: seasonRecords.reduce((sum, item) => sum + item.starts, 0),
        clubLeagueGoals: seasonRecords.reduce((sum, item) => sum + item.goals, 0),
        firstAppearance: milestonesVerified ? record.firstAppearance : null,
        firstStart: milestonesVerified ? record.firstStart : null,
        firstGoal: milestonesVerified ? record.firstGoal : null,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
}

export function buildHistoryData(
  seasons: SeasonHistory[],
  identities: Map<string, PlayerIdentity>,
  generatedAt = new Date().toISOString(),
): HistoryData {
  return {
    generatedAt,
    competitionScope: "league",
    clubScope: "anclas",
    seasons: [...seasons].sort((a, b) => b.year - a.year),
    players: buildPlayerLeagueHistory(seasons, identities),
  };
}
