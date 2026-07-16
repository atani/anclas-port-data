import type { Match, MatchesData } from "./types.js";

/** 結果 push 通知1件分の文面 */
export interface ResultNotification {
  /** 対象試合のID（通知タップ時に該当試合を開くために添える） */
  matchId: string;
  title: string;
  body: string;
}

/** チーム表示名を短縮する（"福岡J・アンクラス" → "アンクラス"） */
function shortTeamName(name: string): string {
  return name.replace(/^福岡J・/, "");
}

/**
 * 新たに finished になったアンクラスの試合を検出する。
 *
 * current 側で「アンクラスが絡む」「finished」「スコアあり」の試合のうち、
 * prev では存在しなかった、または finished でなかったものを返す。
 * prev が null（初回生成）の場合、既存の確定試合すべてを新規扱いすると
 * 大量通知になるため、prev が無いときは何も検出しない。
 */
export function detectNewlyFinishedAnclasMatches(
  prev: MatchesData | null,
  current: Match[],
): Match[] {
  if (!prev) return [];
  const prevStatusById = new Map<string, string>();
  for (const p of prev.matches) prevStatusById.set(p.id, p.status);

  return current.filter((m) => {
    if (!m.isAnclas) return false;
    if (m.status !== "finished") return false;
    if (!m.score) return false;
    return prevStatusById.get(m.id) !== "finished";
  });
}

/** 試合結果 push 通知の文面を組み立てる（ホーム→アウェイの並び順） */
export function buildResultNotification(match: Match): ResultNotification {
  const home = shortTeamName(match.homeTeam);
  const away = shortTeamName(match.awayTeam);
  const body = match.score
    ? `${home} ${match.score.home} - ${match.score.away} ${away}`
    : `${home} vs ${away}`;
  return { matchId: match.id, title: "試合終了", body };
}
