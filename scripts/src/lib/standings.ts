import { ANCLAS_TEAM_NAME, type Match, type StandingRow } from "./types.js";

/**
 * 確定済み試合（status === "finished"）から順位表を計算する。
 * q-league.net に順位表の構造化データが無いため、全試合の勝敗から自前計算する。
 *
 * ソート規則（Qリーグ準拠の一般的な序列）:
 *   1. 勝点が多い
 *   2. 得失点差が大きい
 *   3. 総得点が多い
 *   4. チーム名（昇順・決定不能時の安定化）
 */
export function calculateStandings(matches: Match[]): StandingRow[] {
  type Acc = Omit<StandingRow, "rank" | "gd" | "isAnclas">;
  const table = new Map<string, Acc>();

  const ensure = (team: string): Acc => {
    let row = table.get(team);
    if (!row) {
      row = { team, played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, points: 0 };
      table.set(team, row);
    }
    return row;
  };

  for (const m of matches) {
    if (m.status !== "finished" || !m.score) continue;
    const home = ensure(m.homeTeam);
    const away = ensure(m.awayTeam);
    const { home: hs, away: as_ } = m.score;

    home.played++;
    away.played++;
    home.gf += hs;
    home.ga += as_;
    away.gf += as_;
    away.ga += hs;

    if (hs > as_) {
      home.win++;
      home.points += 3;
      away.loss++;
    } else if (hs < as_) {
      away.win++;
      away.points += 3;
      home.loss++;
    } else {
      home.draw++;
      away.draw++;
      home.points++;
      away.points++;
    }
  }

  const rows = [...table.values()].map((r) => ({
    ...r,
    gd: r.gf - r.ga,
    isAnclas: r.team === ANCLAS_TEAM_NAME,
  }));

  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.team.localeCompare(b.team, "ja"),
  );

  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
