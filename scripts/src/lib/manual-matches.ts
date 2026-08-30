import { existsSync, readFileSync } from "node:fs";
import { ANCLAS_TEAM_NAME, type Match } from "./types.js";

const DATA_DIR = new URL("../../../", import.meta.url);

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

/**
 * 手動管理のカップ戦データ（manual-matches.json）を読み込み、Match型に補完する。
 */
export function loadManualMatches(): Match[] {
  const path = new URL("manual-matches.json", DATA_DIR);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { matches: ManualMatchInput[] };
  return raw.matches.map((match) => {
    const datetime = match.kickoff
      ? `${match.date}T${match.kickoff}:00+09:00`
      : `${match.date}T00:00:00+09:00`;
    return {
      id: match.id,
      competition: match.competition,
      round: null,
      date: match.date,
      kickoff: match.kickoff,
      datetime,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      status: match.status,
      score: match.score,
      isAnclas: match.homeTeam === ANCLAS_TEAM_NAME || match.awayTeam === ANCLAS_TEAM_NAME,
      sourceUrl: match.sourceUrl,
      venue: match.venue,
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
