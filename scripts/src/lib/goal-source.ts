/**
 * GoalNoteの得点数がスコアと一致している場合は公式記録として保持する。
 * クラブの試合レポートは、GoalNote側の得点が欠けている場合だけ補完に使う。
 */
export function shouldUseReportedGoals(
  goalNoteAnclasGoalCount: number,
  anclasScore: number | undefined,
  reportedGoalCount: number,
): boolean {
  return anclasScore !== undefined
    && goalNoteAnclasGoalCount !== anclasScore
    && reportedGoalCount === anclasScore;
}
