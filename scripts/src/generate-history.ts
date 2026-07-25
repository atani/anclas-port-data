import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  fetchGoalNoteGame,
  fetchGoalNoteSchedule,
  parseGoalNoteGame,
  parseGoalNoteSchedule,
} from "./lib/goalnote-parser.js";
import {
  asArray,
  buildHistoryData,
  buildPlayerIdentities,
  normalizePlayerName,
  normalizeTeamName,
  parseNadeshikoMatch,
  type HistoricalRoster,
  type IdentitySeed,
  type NadeshikoMatchDetail,
  type NadeshikoSchedule,
} from "./lib/season-history.js";
import { logger } from "./lib/logger.js";
import { findMatchReport } from "./lib/wordpress-client.js";
import {
  ANCLAS_TEAM_NAME,
  type Match,
  type MatchesData,
  type SeasonHistory,
} from "./lib/types.js";

const DATA_DIR = new URL("../../", import.meta.url);
const IOS_RESOURCES_DIR = new URL("../../ios/AnclasPort/Resources/", import.meta.url);
const CURRENT_MATCHES_PATH = new URL("matches.json", DATA_DIR);
const CURRENT_PLAYERS_PATH = new URL("players.json", DATA_DIR);
const ALIASES_PATH = new URL("./data/player-aliases.json", import.meta.url);
const HISTORY_SOURCES_PATH = new URL("./data/history-sources.json", import.meta.url);

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "anclas-port-history (+https://github.com/atani/anclas-port-data)" },
  });
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${url}`);
  return response.json() as Promise<T>;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  transform: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        output[index] = await transform(values[index]!);
      }
    }),
  );
  return output;
}

async function fetchNadeshikoSeason(
  year: number,
  teamId: string,
): Promise<{ season: SeasonHistory; identities: IdentitySeed[] }> {
  const base = `https://match.nadeshikoleague.jp/${year}/nadeshiko2`;
  const scheduleUrl = `${base}/match/schedule.json`;
  const rosterUrl = `${base}/team_page/member${teamId}.json`;
  const [schedule, roster] = await Promise.all([
    fetchJson<NadeshikoSchedule>(scheduleUrl),
    fetchJson<HistoricalRoster>(rosterUrl),
  ]);
  const rows = schedule.matchScheduleList.matchSchedule.filter(
    (row) => row.homeTeamNo === teamId || row.awayTeamNo === teamId,
  );
  const matches = await mapConcurrent(rows, 6, async (row) => {
    const url = `${base}/match_page/m${row.matchNumber}.json`;
    return parseNadeshikoMatch(year, await fetchJson<NadeshikoMatchDetail>(url));
  });
  const identities = asArray(roster.teamMemberList.teamMember).map((member) => ({
    name: member.personName,
    birthDate: member.birthdayDate ? member.birthdayDate.replaceAll("/", "-") : null,
  }));
  logger.info(`${year}: なでしこリーグ ${matches.length}試合`);
  return {
    season: {
      year,
      competition: schedule.matchScheduleList.competitionName,
      sourceType: "nadeshiko-json",
      sourceUrl: scheduleUrl,
      matches: matches.sort((a, b) => a.datetime.localeCompare(b.datetime)),
    },
    identities,
  };
}

function sidFromUrl(url: string): string {
  return new URL(url).searchParams.get("sid") ?? url;
}

async function fetchGoalNoteSeason(year: number, tournamentId: string): Promise<SeasonHistory> {
  const scheduleHtml = await fetchGoalNoteSchedule(tournamentId);
  const rows = parseGoalNoteSchedule(scheduleHtml).filter(
    (row) =>
      normalizeTeamName(row.homeTeam) === ANCLAS_TEAM_NAME ||
      normalizeTeamName(row.awayTeam) === ANCLAS_TEAM_NAME,
  );
  const matches = await mapConcurrent(rows, 4, async (row): Promise<Match> => {
    if (!row.gameUrl) throw new Error(`${year}: GoalNote game URL missing: ${row.date}`);
    const homeTeam = normalizeTeamName(row.homeTeam);
    const awayTeam = normalizeTeamName(row.awayTeam);
    const game = parseGoalNoteGame(await fetchGoalNoteGame(row.gameUrl), homeTeam);
    let goals = game.goals.map((goal) => ({ ...goal, team: normalizeTeamName(goal.team) }));
    const anclasSide = homeTeam === ANCLAS_TEAM_NAME ? "home" : "away";
    const anclasScore = row.score?.[anclasSide] ?? 0;
    const parsedAnclasGoals = goals.filter(
      (goal) => normalizeTeamName(goal.team) === ANCLAS_TEAM_NAME,
    );
    if (row.score && parsedAnclasGoals.length !== anclasScore) {
      const opponentName = anclasSide === "home" ? awayTeam : homeTeam;
      const report = await findMatchReport(opponentName, row.date);
      if (report?.reportedGoals.length === anclasScore) {
        goals = [
          ...goals.filter((goal) => normalizeTeamName(goal.team) !== ANCLAS_TEAM_NAME),
          ...report.reportedGoals.map((goal) => ({
            ...goal,
            team: ANCLAS_TEAM_NAME,
            assist: null,
          })),
        ];
        logger.info(`${year}-${row.date}: 公式レポートから得点 ${anclasScore}件を補完`);
      } else {
        logger.warn(
          `${year}-${row.date}: 得点数不一致（スコア ${anclasScore} / GoalNote ${parsedAnclasGoals.length} / 公式レポート ${report?.reportedGoals.length ?? 0}）`,
        );
      }
    }
    return {
      id: `goalnote-${year}-${sidFromUrl(row.gameUrl)}`,
      season: String(year),
      competition: `${year}年度 九州女子サッカーリーグ1部`,
      round: null,
      date: row.date,
      kickoff: row.kickoff,
      datetime: `${row.date}T${row.kickoff ?? "00:00"}:00+09:00`,
      homeTeam,
      awayTeam,
      status: row.score ? "finished" : "scheduled",
      score: row.score,
      isAnclas: true,
      sourceUrl: row.gameUrl,
      venue: row.venue,
      goals,
      starters: game.starters,
      subs: game.subs,
      substitutions: game.substitutions,
      stats: game.stats,
      goalnoteUrl: row.gameUrl,
      posterUrl: null,
      matchdayProgramUrl: null,
      cards: game.cards,
      matchReport: null,
      photoGallery: [],
      forecast: null,
    };
  });
  logger.info(`${year}: GoalNote ${matches.length}試合`);
  return {
    year,
    competition: `${year}年度 九州女子サッカーリーグ1部`,
    sourceType: "goalnote",
    sourceUrl: `https://www.goalnote.net/detail.php?tid=${tournamentId}`,
    matches: matches.sort((a, b) => a.datetime.localeCompare(b.datetime)),
  };
}

function parseJapaneseBirthDate(value: string | null | undefined): string | null {
  const match = value?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  return `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
}

function currentSeason(): { season: SeasonHistory; identities: IdentitySeed[] } {
  const matchesData = JSON.parse(readFileSync(CURRENT_MATCHES_PATH, "utf-8")) as MatchesData;
  const playersData = JSON.parse(readFileSync(CURRENT_PLAYERS_PATH, "utf-8")) as {
    players: Array<{ nameJa: string; profile?: { birthdate?: string | null } }>;
  };
  const year = Number(matchesData.season);
  const matches = matchesData.matches
    .filter((match) => match.isAnclas)
    .map((match) => ({ ...match, season: String(year) }));
  return {
    season: {
      year,
      competition: matches[0]?.competition ?? "Qリーグ",
      sourceType: "current",
      sourceUrl: "https://q-league.net/match/",
      matches,
    },
    identities: playersData.players.map((player) => ({
      name: player.nameJa,
      birthDate: parseJapaneseBirthDate(player.profile?.birthdate),
    })),
  };
}

function attachPlayerIds(
  seasons: SeasonHistory[],
  identities: ReturnType<typeof buildPlayerIdentities>,
): void {
  for (const season of seasons) {
    for (const match of season.matches) {
      const anclasSide = match.homeTeam === ANCLAS_TEAM_NAME ? "home" : "away";
      for (const player of [...match.starters, ...match.subs]) {
        player.playerId = player.team === anclasSide
          ? identities.get(normalizePlayerName(player.name))?.playerId ?? null
          : null;
      }
      for (const goal of match.goals) {
        goal.playerId = normalizeTeamName(goal.team) === ANCLAS_TEAM_NAME
          ? identities.get(normalizePlayerName(goal.playerName))?.playerId ?? null
          : null;
      }
    }
  }
}

/**
 * null と空配列のキーを落とす。iOS 側はすべて Optional なので欠落しても読める。
 */
function omitEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitEmpty);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && !(Array.isArray(item) && item.length === 0))
      .map(([key, item]) => [key, omitEmpty(item)]),
  );
}

/**
 * history.json はアプリが更新のたびに取得するため、整形せずに書き出す。
 * 差分は generatedAt 以外ほとんど動かず、行単位で読む価値も無い。
 */
function writeJson(url: URL, value: unknown): void {
  mkdirSync(new URL("./", url), { recursive: true });
  writeFileSync(url, `${JSON.stringify(omitEmpty(value))}\n`);
}

async function main(): Promise<void> {
  const sources = JSON.parse(readFileSync(HISTORY_SOURCES_PATH, "utf-8")) as {
    nadeshiko: Array<{ year: number; teamId: string }>;
    goalnote: Array<{ year: number; tournamentId: string }>;
  };
  const nadeshiko = await Promise.all(
    sources.nadeshiko.map(({ year, teamId }) => fetchNadeshikoSeason(year, teamId)),
  );
  const goalnote = await Promise.all(
    sources.goalnote.map(({ year, tournamentId }) => fetchGoalNoteSeason(year, tournamentId)),
  );
  const current = currentSeason();
  const aliases = JSON.parse(readFileSync(ALIASES_PATH, "utf-8")) as Record<string, string[]>;
  const seeds = [
    ...nadeshiko.flatMap((item) => item.identities),
    ...current.identities,
  ].map((seed) => ({ ...seed, aliases: aliases[normalizePlayerName(seed.name)] ?? [] }));

  const seasons = [
    current.season,
    ...goalnote,
    ...nadeshiko.map((item) => item.season),
  ].sort((a, b) => b.year - a.year);
  for (const season of seasons) {
    for (const match of season.matches) {
      const side = match.homeTeam === ANCLAS_TEAM_NAME ? "home" : "away";
      const names = [
        ...match.starters.filter((player) => player.team === side).map((player) => player.name),
        ...match.subs.filter((player) => player.team === side).map((player) => player.name),
        ...match.substitutions
          .filter((substitution) => substitution.team === side)
          .flatMap((substitution) => [substitution.outName, substitution.inName]),
        ...match.goals
          .filter((goal) => normalizeTeamName(goal.team) === ANCLAS_TEAM_NAME)
          .map((goal) => goal.playerName),
      ];
      for (const name of names) {
        if (/オウンゴール/.test(name)) continue;
        if (!seeds.some((seed) => normalizePlayerName(seed.name) === normalizePlayerName(name))) {
          seeds.push({ name, birthDate: null, aliases: aliases[normalizePlayerName(name)] ?? [] });
        }
      }
    }
  }

  const identities = buildPlayerIdentities(seeds);
  attachPlayerIds(seasons, identities);
  // 通算成績は当年を含めて数えるが、試合一覧は過去シーズンだけを載せる。
  // 当年はアプリが matches.json を使うため、載せると同じ内容を二重に配ることになる。
  const history = {
    ...buildHistoryData(seasons, identities),
    seasons: seasons.filter((season) => season.year !== current.season.year),
  };
  writeJson(new URL("history.json", DATA_DIR), history);
  // iOS 同梱データはこのリポジトリにしか無い（generate-matches.ts と同じ扱い）
  const wroteIos = existsSync(IOS_RESOURCES_DIR);
  if (wroteIos) {
    writeJson(new URL("history.json", IOS_RESOURCES_DIR), history);
  }
  logger.info(`wrote history.json (${wroteIos ? "data, ios" : "data"})`);
  logger.info(
    `履歴生成完了: ${history.seasons.length}シーズン（当年を除く） / ${history.players.length}選手`,
  );
}

main().catch((error) => {
  logger.error(`generate-history failed: ${error}`);
  process.exitCode = 1;
});
