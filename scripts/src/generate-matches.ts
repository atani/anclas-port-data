import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  enrichMatchesWithSchedule,
  fetchGoalNoteGame,
  fetchGoalNoteRanking,
  fetchGoalNoteSchedule,
  parseGoalNoteGame,
  parseGoalNoteSchedule,
  parseScorerRanking,
} from "./lib/goalnote-parser.js";
import { computeAssists } from "./lib/assists.js";
import { computeScorers } from "./lib/scorers.js";
import { buildResultNotification, detectNewlyFinishedAnclasMatches } from "./lib/result-diff.js";
import { writeNotifyQueue } from "./lib/notify-queue.js";
import {
  buildPodcastNotification,
  detectNewPodcastEpisodes,
  MATCH_RESULTS_TOPIC,
  podcastEpisodeId,
  type RemoteNotification,
} from "./lib/remote-notification.js";
import { normalizeTeamName, parseQLeagueMatches } from "./lib/qleague-parser.js";
import { fetchShopItems } from "./lib/shop.js";
import { fetchForecast } from "./lib/weather-client.js";
import { fetchLatestPodcasts } from "./lib/spotify.js";
import { fetchLatestYouTubeVideos } from "./lib/youtube.js";
import { mergeMedia } from "./lib/media-merge.js";
import { calculateStandings } from "./lib/standings.js";
import { loadVerifiedReschedules } from "./lib/reschedule-cache.js";
import {
  applyRescheduleInfo,
  findMatchPoster,
  findMatchReport,
  findRescheduleInfo,
  selectRescheduleInfo,
} from "./lib/wordpress-client.js";
import { logger } from "./lib/logger.js";
import {
  ANCLAS_TEAM_NAME,
  type Match,
  type MatchesData,
  type PodcastEpisode,
  type ScorerRank,
  type StandingsData,
  type YouTubeVideo,
} from "./lib/types.js";

const Q_LEAGUE_URL = "https://q-league.net/match/";
const COMPETITION = "Qリーグ";
const DATA_DIR = new URL("../../", import.meta.url);

/// 一過性のネットワークエラーで毎時 run が落ちないよう、指数バックオフ付きで最大3回試行する
async function fetchHtml(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "anclas-port-pipeline (+https://github.com/atani/anclas-port)" },
      });
      if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} ${url}`);
      return await res.text();
    } catch (e) {
      lastError = e;
      if (attempt < 3) {
        logger.warn(`fetch retry ${attempt}/2 (${url}): ${e}`);
        await new Promise((resolve) => setTimeout(resolve, 3_000 * attempt));
      }
    }
  }
  throw lastError;
}

/** players.json から「名前(空白除去) → 背番号」マップを作る（得点ランキングの番号補完用） */
function loadPlayerNumberByName(): Map<string, number> {
  const map = new Map<string, number>();
  const url = new URL("players.json", DATA_DIR);
  if (!existsSync(url)) return map;
  try {
    const data = JSON.parse(readFileSync(url, "utf-8")) as {
      players: { number: number | null; nameJa: string }[];
    };
    for (const p of data.players) {
      if (p.number !== null) map.set(p.nameJa.replace(/[\s　]/g, ""), p.number);
    }
  } catch {
    /* ignore */
  }
  return map;
}

function inferSeason(matches: Match[]): string {
  const counts = new Map<string, number>();
  for (const m of matches) {
    const year = m.date.slice(0, 4);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  let best = "";
  let max = -1;
  for (const [year, n] of counts) {
    if (n > max) { max = n; best = year; }
  }
  return best;
}

function pickNextMatch(matches: Match[], nowMs: number): Match | null {
  return matches
    .filter((m) => m.isAnclas && m.status === "scheduled" && Date.parse(m.datetime) >= nowMs)
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))[0] ?? null;
}

function pickLatestResult(matches: Match[]): Match | null {
  return matches
    .filter((m) => m.isAnclas && m.status === "finished")
    .sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime))[0] ?? null;
}

function writeJson(name: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const json = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(new URL(name, DATA_DIR), json, "utf-8");
  // iOS 同梱データはこのリポジトリにしか無い。実運用の anclas-port-data 側で
  // 空のディレクトリを作らないよう、既に存在する場合だけ書き出す。
  const iosResourcesDir = new URL("../../ios/AnclasPort/Resources/", import.meta.url);
  const wroteIos = existsSync(iosResourcesDir);
  if (wroteIos) {
    writeFileSync(new URL(name, iosResourcesDir), json, "utf-8");
  }
  // 宛先を残す。ios が抜けたまま通っていないかを実行ログで確かめられるようにする。
  logger.info(`wrote ${name} (${wroteIos ? "data, ios" : "data"})`);
}

/**
 * 手動管理のカップ戦データ（manual-matches.json）を読み込み、Match型に補完する。
 * events.jsonと同様、このパイプラインの上書き対象から除外し、人手で更新する
 * （皇后杯のようなノックアウト方式の大会は、対戦相手が他都道府県の代表チームで
 * Qリーグに所属しないため、Qリーグ公式サイトのスクレイピング対象にできない）。
 * 更新は scripts/src/advance-cup-match.ts で行う。
 */
interface ManualMatchInput {
  id: string;
  competition: string;
  date: string;
  kickoff: string | null;
  homeTeam: string;
  awayTeam: string;
  status: "scheduled" | "finished";
  score: { home: number; away: number } | null;
  venue: string | null;
  sourceUrl: string;
}

export function loadManualMatches(): Match[] {
  const path = new URL("manual-matches.json", DATA_DIR);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { matches: ManualMatchInput[] };
  return raw.matches.map((m) => {
    const datetime = m.kickoff ? `${m.date}T${m.kickoff}:00+09:00` : `${m.date}T00:00:00+09:00`;
    return {
      id: m.id,
      competition: m.competition,
      round: null,
      date: m.date,
      kickoff: m.kickoff,
      datetime,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      status: m.status,
      score: m.score,
      isAnclas: m.homeTeam === ANCLAS_TEAM_NAME || m.awayTeam === ANCLAS_TEAM_NAME,
      sourceUrl: m.sourceUrl,
      venue: m.venue,
      goals: [],
      starters: [],
      subs: [],
      substitutions: [],
      stats: null,
      goalnoteUrl: null,
      posterUrl: null,
      matchdayProgramUrl: null,
      cards: [],
      matchReport: null,
      photoGallery: [],
      forecast: null,
    } satisfies Match;
  });
}

function readPreviousMatchesData(): MatchesData | null {
  const prevPath = new URL("matches.json", DATA_DIR);
  if (!existsSync(prevPath)) return null;
  try {
    return JSON.parse(readFileSync(prevPath, "utf-8")) as MatchesData;
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 160) : "unknown error";
    logger.warn(`前回matches.jsonの読み込み失敗（前回値の復元・通知差分をスキップ）: ${detail}`);
    return null;
  }
}

function queueRemoteNotifications(
  previous: MatchesData | null,
  matches: Match[],
  podcastEpisodes: PodcastEpisode[],
): void {
  const resultNotifications: RemoteNotification[] =
    detectNewlyFinishedAnclasMatches(previous, matches).map((match) => {
      const notification = buildResultNotification(match);
      return {
        topic: MATCH_RESULTS_TOPIC,
        title: notification.title,
        body: notification.body,
        data: { type: "match-result", matchId: notification.matchId },
      };
    });
  const previousPodcasts = previous?.anclas.podcastEpisodes?.length
    ? previous.anclas.podcastEpisodes
    : previous?.anclas.latestPodcast
      ? [previous.anclas.latestPodcast]
      : [];
  const podcastNotifications = detectNewPodcastEpisodes(previousPodcasts, podcastEpisodes)
    .slice(0, 1)
    .map(buildPodcastNotification)
    .filter((item): item is RemoteNotification => item !== null);
  const notifications = [...resultNotifications, ...podcastNotifications];
  writeNotifyQueue(notifications);
  if (resultNotifications.length > 0) logger.info(`結果通知キュー: ${resultNotifications.length}件`);
  if (podcastNotifications.length > 0) logger.info(`Podcast通知キュー: ${podcastNotifications.length}件`);
}

async function main(): Promise<void> {
  const previousMatchesData = readPreviousMatchesData();
  // 1. q-league → 試合一覧
  const qHtml = await fetchHtml(Q_LEAGUE_URL);
  const matches = parseQLeagueMatches(qHtml, { competition: COMPETITION });
  if (matches.length === 0) throw new Error("試合を1件も抽出できませんでした");
  if (!matches.some((m) => m.isAnclas)) throw new Error(`${ANCLAS_TEAM_NAME} の試合が見つかりませんでした`);

  // 1.5. 延期・振替待ちのアンクラス試合 → anclas.jp の代替日程告知から確定日程を取得
  {
    const now = Date.now();
    const verifiedReschedules = loadVerifiedReschedules();
    const postponed = matches.filter(
      (m) => m.isAnclas && m.status === "scheduled" && Date.parse(m.datetime) < now,
    );
    let rescheduledCount = 0;
    let unresolvedCount = 0;
    for (const m of postponed) {
      try {
        const opponent = m.homeTeam === ANCLAS_TEAM_NAME ? m.awayTeam : m.homeTeam;
        const originalDate = m.date;
        const discovered = await findRescheduleInfo(opponent, m.date);
        const info = selectRescheduleInfo(m.id, discovered, verifiedReschedules);
        if (info && applyRescheduleInfo(m, info)) {
          logger.info(
            `延期試合の代替日程を${discovered ? "検出" : "確認済みキャッシュから復元"}: round${m.round} ${originalDate}→${info.date} (${opponent}) ${info.sourceUrl}`,
          );
          rescheduledCount++;
        } else if (!info) {
          unresolvedCount++;
        }
      } catch {
        // 非致命
      }
    }
    if (rescheduledCount > 0) logger.info(`延期試合の代替日程: ${rescheduledCount}件更新`);
    if (unresolvedCount > 0) {
      logger.info(`延期試合の代替日程: ${unresolvedCount}件は告知未確認のため延期のまま`);
    }
  }

  // 2. GoalNote schedule → 会場・game URL を補完
  try {
    const gnHtml = await fetchGoalNoteSchedule();
    const gnRows = parseGoalNoteSchedule(gnHtml);
    enrichMatchesWithSchedule(matches, gnRows);
    logger.info(`GoalNote schedule: ${gnRows.length}行取得、会場を補完`);
  } catch (e) {
    logger.warn(`GoalNote schedule 取得失敗（会場なしで続行）: ${e}`);
  }

  // 3. GoalNote game → アンクラスの確定試合に得点経過を補完
  const anclasFinished = matches.filter((m) => m.isAnclas && m.status === "finished" && m.goalnoteUrl);
  let goalCount = 0;
  for (const m of anclasFinished) {
    try {
      const gameHtml = await fetchGoalNoteGame(m.goalnoteUrl!);
      const gameData = parseGoalNoteGame(gameHtml, m.homeTeam);
      m.goals = gameData.goals.map((goal) => ({
        ...goal,
        team: normalizeTeamName(goal.team),
      }));
      m.starters = gameData.starters;
      m.subs = gameData.subs;
      m.substitutions = gameData.substitutions;
      m.cards = gameData.cards;
      m.stats = gameData.stats;
      goalCount += gameData.goals.length;
    } catch (e) {
      logger.warn(`GoalNote game 取得失敗 ${m.goalnoteUrl}: ${e}`);
    }
  }
  logger.info(`GoalNote game: ${anclasFinished.length}試合から${goalCount}ゴール取得`);

  // 4. anclas.jp マッチレポート → 監督・選手コメントを補完
  const allAnclasFinished = matches.filter((m) => m.isAnclas && m.status === "finished");
  let reportCount = 0;
  for (const m of allAnclasFinished) {
    try {
      const opponent = m.homeTeam === ANCLAS_TEAM_NAME ? m.awayTeam : m.homeTeam;
      const result = await findMatchReport(opponent, m.date);
      if (result) {
        m.matchReport = result.report;
        if (result.photoGallery.length > 0) m.photoGallery = result.photoGallery;
        const anclasScore = m.homeTeam === ANCLAS_TEAM_NAME ? m.score?.home : m.score?.away;
        const currentAnclasGoals = m.goals.filter(
          (goal) => goal.team === ANCLAS_TEAM_NAME,
        );
        const scorerNames = (goals: Array<{ playerName: string }>) =>
          goals.map((goal) => goal.playerName.replace(/[\s　]/g, "")).sort().join("|");
        const scorerMismatch =
          result.reportedGoals.length === anclasScore
          && scorerNames(currentAnclasGoals) !== scorerNames(result.reportedGoals);
        if (
          (currentAnclasGoals.length !== anclasScore || scorerMismatch)
          && result.reportedGoals.length === anclasScore
        ) {
          m.goals = [
            ...m.goals.filter((goal) => goal.team !== ANCLAS_TEAM_NAME),
            ...result.reportedGoals.map((goal) => ({
              ...goal,
              team: ANCLAS_TEAM_NAME,
              assist: null,
            })),
          ];
        }
        reportCount++;
      }
    } catch {
      // 非致命
    }
  }
  if (reportCount > 0) logger.info(`マッチレポート: ${reportCount}件取得`);

  // 4.5 確定試合の不変データを前回 matches.json から引き継ぐ
  // CI 環境では anclas.jp が 403 を返しマッチレポート等を取得できないため、
  // 一度取得済みの確定試合データ（得点・メンバー・レポート）を前回値で補完する
  if (previousMatchesData) {
    const prevById = new Map(previousMatchesData.matches.map((p) => [p.id, p]));
    let restoredReports = 0;
    for (const m of matches) {
      if (m.status !== "finished") continue;
      const p = prevById.get(m.id);
      if (!p) continue;
      if (m.goals.length === 0 && p.goals.length > 0) m.goals = p.goals;
      if (m.starters.length === 0 && p.starters.length > 0) m.starters = p.starters;
      if (m.subs.length === 0 && p.subs.length > 0) m.subs = p.subs;
      if (m.substitutions.length === 0 && p.substitutions.length > 0) m.substitutions = p.substitutions;
      if (m.cards.length === 0 && p.cards.length > 0) m.cards = p.cards;
      if (!m.stats && p.stats) m.stats = p.stats;
      if (!m.matchReport && p.matchReport) {
        m.matchReport = p.matchReport;
        restoredReports++;
      }
      if (m.photoGallery.length === 0 && p.photoGallery && p.photoGallery.length > 0) {
        m.photoGallery = p.photoGallery;
      }
    }
    if (restoredReports > 0) logger.info(`前回値から${restoredReports}件のマッチレポートを引き継ぎ`);
  }

  // 4.5. 手動管理のカップ戦データ（manual-matches.json）を合成する
  // Qリーグ側のQ&A enrichment（延期確認・GoalNote補完）が完了した後に加えることで、
  // 対戦相手名の突き合わせによる誤補完を避ける。
  const manualMatches = loadManualMatches();
  if (manualMatches.length > 0) {
    matches.push(...manualMatches);
    matches.sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
    logger.info(`手動管理のカップ戦データ: ${manualMatches.length}件を合成`);
  }

  // 5. 次の試合のポスター画像を anclas.jp から取得
  // 該当する告知投稿が無ければ null のまま（古いポスターは出さない）
  const nextMatch = pickNextMatch(matches, Date.now());
  if (nextMatch) {
    try {
      const opponent = nextMatch.homeTeam === ANCLAS_TEAM_NAME ? nextMatch.awayTeam : nextMatch.homeTeam;
      const posterUrl = await findMatchPoster(opponent, nextMatch.date);
      if (posterUrl) {
        nextMatch.posterUrl = posterUrl;
        logger.info(`ポスター取得: ${posterUrl.slice(-40)}`);
      } else {
        logger.warn(`ポスター未取得（該当告知なし or WP APIエラー）: ${nextMatch.date} vs ${opponent}`);
      }
    } catch {
      logger.warn("ポスター取得失敗（WP API エラー）");
    }
  }

  // 5.5. マッチデープログラム PDF（ホームゲームのみ）
  {
    let found = 0;
    for (const m of matches) {
      if (!m.isAnclas) continue;
      // 前回値引き継ぎ
      if (m.matchdayProgramUrl) { found++; continue; }
      const [y, mon, day] = m.date.split("-").map(Number);
      const monthStr = String(mon).padStart(2, "0");
      const dateLabel = `${mon}.${day}`;
      const encoded = encodeURIComponent(`${dateLabel}マッチデープログラム`) + ".pdf";
      const url = `https://anclas.jp/wp-content/uploads/${y}/${monthStr}/${encoded}`;
      try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
        if (res.ok) {
          m.matchdayProgramUrl = url;
          found++;
        }
      } catch { /* not found */ }
    }
    if (found > 0) logger.info(`マッチデープログラム: ${found}試合分`);
  }

  // 5.7. 会場の天気予報（キックオフ 14 日前から、Open-Meteo）
  try {
    const venuesPath = new URL("./data/venues.json", import.meta.url);
    const venues = JSON.parse(readFileSync(venuesPath, "utf-8")) as Record<
      string,
      { latitude: number; longitude: number; place: string }
    >;
    const now = Date.now();
    let forecastCount = 0;
    for (const m of matches) {
      if (!m.isAnclas || m.status !== "scheduled" || !m.venue) continue;
      const venue = venues[m.venue];
      if (!venue) continue;
      const daysAhead = (new Date(m.datetime).getTime() - now) / 86_400_000;
      if (daysAhead < 0 || daysAhead > 14) continue;
      try {
        m.forecast = await fetchForecast(venue.latitude, venue.longitude, m.datetime);
        if (m.forecast) forecastCount++;
      } catch (e) {
        logger.warn(`天気予報取得失敗 ${m.date} ${m.venue}: ${e}`);
      }
    }
    if (forecastCount > 0) logger.info(`天気予報: ${forecastCount}試合分取得`);
  } catch {
    // venues.json が無くても致命ではない
  }

  // 前回値引き継ぎ: matchdayProgramUrl
  if (previousMatchesData) {
    const prevById = new Map(previousMatchesData.matches.map((p) => [p.id, p]));
    for (const m of matches) {
      if (!m.matchdayProgramUrl) {
        const p = prevById.get(m.id);
        if (p?.matchdayProgramUrl) {
          m.matchdayProgramUrl = p.matchdayProgramUrl;
        }
      }
    }
  }

  // 6. ポッドキャスト新着エピソード（公開ページ, 認証不要）
  const fetchedPodcastEpisodes = await fetchLatestPodcasts();
  const previousPodcastEpisodes = previousMatchesData?.anclas.podcastEpisodes?.length
    ? previousMatchesData.anclas.podcastEpisodes
    : previousMatchesData?.anclas.latestPodcast
      ? [previousMatchesData.anclas.latestPodcast]
      : [];
  const podcastEpisodes = mergeMedia(
    fetchedPodcastEpisodes,
    previousPodcastEpisodes,
    podcastEpisodeId,
  );
  const podcastFallbackCount = Math.max(0, podcastEpisodes.length - fetchedPodcastEpisodes.length);
  if (podcastFallbackCount > 0) {
    logger.warn(`Podcast: 前回値${podcastFallbackCount}件で不足分を補完`);
  }
  const latestPodcast = podcastEpisodes[0] ?? null;
  if (latestPodcast) {
    logger.info(`ポッドキャスト: ${latestPodcast.title.slice(0, 40)}`);
  } else {
    logger.warn("ポッドキャスト取得失敗");
  }

  // 6. YouTube 最新（通常動画＋ショート別々に）
  const fetchedYouTube = await fetchLatestYouTubeVideos();
  const previousYoutubeVideos = previousMatchesData?.anclas.youtubeVideos?.length
    ? previousMatchesData.anclas.youtubeVideos
    : previousMatchesData?.anclas.latestYouTube
      ? [previousMatchesData.anclas.latestYouTube]
      : [];
  const previousYoutubeShorts = previousMatchesData?.anclas.youtubeShorts?.length
    ? previousMatchesData.anclas.youtubeShorts
    : previousMatchesData?.anclas.latestYouTubeShort
      ? [previousMatchesData.anclas.latestYouTubeShort]
      : [];
  const youtubeVideos = mergeMedia(
    fetchedYouTube.videos,
    previousYoutubeVideos,
    (video) => video.videoId,
  );
  const youtubeShorts = mergeMedia(
    fetchedYouTube.shorts,
    previousYoutubeShorts,
    (video) => video.videoId,
  );
  const latestYouTube: YouTubeVideo | null = youtubeVideos[0] ?? null;
  const latestYouTubeShort: YouTubeVideo | null = youtubeShorts[0] ?? null;
  const videoFallbackCount = Math.max(0, youtubeVideos.length - fetchedYouTube.videos.length);
  const shortFallbackCount = Math.max(0, youtubeShorts.length - fetchedYouTube.shorts.length);
  if (videoFallbackCount > 0) {
    logger.warn(`YouTube通常動画: 前回値${videoFallbackCount}件で不足分を補完`);
  }
  if (shortFallbackCount > 0) {
    logger.warn(`YouTube Shorts: 前回値${shortFallbackCount}件で不足分を補完`);
  }
  if (latestYouTube) logger.info(`YouTube: ${latestYouTube.title.slice(0, 40)}`);
  if (latestYouTubeShort) logger.info(`YouTubeショート: ${latestYouTubeShort.title.slice(0, 40)}`);
  if (!latestYouTube && !latestYouTubeShort) logger.warn("YouTube 取得失敗");

  // 7. オンラインショップ商品（取得失敗時は前回値を引き継ぐ）
  let shopItems = await fetchShopItems();
  if (shopItems.length === 0 && previousMatchesData?.anclas.shopItems?.length) {
    shopItems = previousMatchesData.anclas.shopItems;
    logger.info(`ショップ: 前回値${shopItems.length}件を引き継ぎ`);
  } else if (shopItems.length > 0) {
    logger.info(`ショップ: ${shopItems.length}商品取得`);
  }

  const generatedAt = new Date().toISOString();
  const season = inferSeason(matches);

  const matchesData: MatchesData = {
    generatedAt,
    season,
    anclas: {
      nextMatch,
      latestResult: pickLatestResult(matches),
      latestPodcast,
      podcastEpisodes,
      latestYouTube,
      youtubeVideos,
      latestYouTubeShort,
      youtubeShorts,
      shopItems,
    },
    matches,
  };

  // 6. 得点ランキング（GoalNote）→ アンクラス選手のみ
  let scorers: ScorerRank[] = [];
  try {
    const numberByName = loadPlayerNumberByName();
    const rankHtml = await fetchGoalNoteRanking();
    scorers = parseScorerRanking(rankHtml, numberByName);
    if (scorers.length > 0) logger.info(`得点ランキング: アンクラス${scorers.length}人`);
  } catch {
    logger.warn("得点ランキング取得失敗");
  }
  // 取得失敗時は前回 standings.json の scorers を引き継ぐ
  if (scorers.length === 0) {
    const prevStandings = new URL("standings.json", DATA_DIR);
    if (existsSync(prevStandings)) {
      try {
        const prev = JSON.parse(readFileSync(prevStandings, "utf-8")) as StandingsData;
        if (prev.scorers?.length) {
          scorers = prev.scorers;
          logger.info(`得点ランキング: 前回値${scorers.length}人を引き継ぎ`);
        }
      } catch {
        /* ignore */
      }
    }
  }
  const numberByName = loadPlayerNumberByName();
  scorers = computeScorers(matches, scorers, numberByName);

  // アシストランキング（試合データから自前集計）
  const anclasNumbers = new Set<number>(numberByName.values());
  const assists = computeAssists(matches, anclasNumbers, numberByName);
  if (assists.length > 0) logger.info(`アシストランキング: ${assists.length}人`);

  const standingsData: StandingsData = {
    generatedAt,
    season,
    competition: COMPETITION,
    table: calculateStandings(matches),
    scorers,
    assists,
  };

  // 結果 push 通知キュー: 上書き前の matches.json（＝前回値）と比較し、
  // 新たに finished になったアンクラス試合を検出してキューに書き出す。
  // 実際の FCM 送信は notify ステップ（FCM_SERVICE_ACCOUNT_JSON 必要）が行う。
  queueRemoteNotifications(previousMatchesData, matches, podcastEpisodes);

  writeJson("matches.json", matchesData);
  writeJson("standings.json", standingsData);

  const anclas = matches.filter((m) => m.isAnclas);
  const venued = matches.filter((m) => m.venue).length;
  logger.info(
    `done: ${matches.length}試合 / アンクラス${anclas.length}試合 / 会場あり${venued} / 順位表${standingsData.table.length}チーム / season=${season}`,
  );
}

main().catch((err) => {
  logger.error(`失敗: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
