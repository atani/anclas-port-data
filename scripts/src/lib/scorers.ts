import {
  ANCLAS_TEAM_NAME,
  type Match,
  type ScorerRank,
} from "./types.js";

type ScorerMatch = Pick<Match, "status" | "isAnclas" | "goals">;

function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(/[\s　]/g, "");
}

/**
 * 試合別の得点イベントから得点ランキングを再構築する。
 * GoalNoteランキングはリーグ順位と表記の補助に使うが、試合記録と得点数が
 * 食い違う選手には誤ったリーグ順位を表示しない。
 */
export function computeScorers(
  matches: ScorerMatch[],
  sourceRanking: ScorerRank[],
  playerNumberByName: Map<string, number>,
): ScorerRank[] {
  const sourceByName = new Map(
    sourceRanking.map((scorer) => [normalizeName(scorer.name), scorer]),
  );
  const totals = new Map<string, { name: string; number: number | null; goals: number }>();

  for (const match of matches) {
    if (!match.isAnclas || match.status !== "finished") continue;
    for (const goal of match.goals) {
      if (goal.team !== ANCLAS_TEAM_NAME || /オウンゴール/.test(goal.playerName)) continue;
      const key = normalizeName(goal.playerName);
      const current = totals.get(key);
      totals.set(key, {
        name: sourceByName.get(key)?.name ?? current?.name ?? goal.playerName,
        number:
          playerNumberByName.get(key)
          ?? current?.number
          ?? goal.playerNumber
          ?? null,
        goals: (current?.goals ?? 0) + 1,
      });
    }
  }

  const scorers = [...totals.entries()]
    .map(([key, total]): ScorerRank => {
      const source = sourceByName.get(key);
      return {
        rank: 0,
        leagueRank: source?.goals === total.goals ? source.leagueRank : null,
        name: total.name,
        number: total.number,
        goals: total.goals,
      };
    })
    .sort(
      (a, b) =>
        b.goals - a.goals
        || (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER)
        || a.name.localeCompare(b.name, "ja"),
    );

  let previousGoals = -1;
  let previousRank = 0;
  for (let index = 0; index < scorers.length; index++) {
    const scorer = scorers[index]!;
    if (scorer.goals !== previousGoals) {
      previousGoals = scorer.goals;
      previousRank = index + 1;
    }
    scorer.rank = previousRank;
  }
  return scorers;
}
