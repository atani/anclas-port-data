import { ANCLAS_TEAM_NAME, type AssistRank, type Match } from "./types.js";

/**
 * アシスト文字列（例: "22→11S" / "5↑13S" / "15浮き球パス→5ヘディング"）から
 * アシストした選手の背番号を抽出する。抽出できなければ null。
 * PK（"16PK" 等）と ×（ダイレクト）はアシストなしとして null。
 */
export function parseAssistNumber(assist: string | null): number | null {
  if (!assist || assist.includes("PK") || assist.startsWith("×")) return null;
  const parts = assist.split(/[→↑]/);
  if (parts.length < 2) return null;
  const numMatch = parts[0]?.match(/^(\d+)/);
  if (!numMatch) return null;
  return Number(numMatch[1]);
}

/**
 * 全試合のゴールデータからアンクラス選手のアシストランキングを集計する。
 * - アンクラスの得点のみ対象
 * - anclasNumbers（選手名鑑の背番号）が非空なら在籍選手のみカウント
 * - 同アシスト数は同順位（1,1,3 形式）
 */
export function computeAssists(
  matches: Match[],
  anclasNumbers: Set<number>,
  numberByName: Map<string, number>,
): AssistRank[] {
  // 背番号 → 選手名の逆引き（1回だけ構築）
  const nameByNumber = new Map<number, string>();
  for (const [name, num] of numberByName) {
    if (!nameByNumber.has(num)) nameByNumber.set(num, name);
  }

  const assistCount = new Map<number, { name: string; number: number; assists: number }>();
  for (const m of matches) {
    if (!m.isAnclas || m.status !== "finished") continue;
    for (const g of m.goals) {
      if (g.team !== ANCLAS_TEAM_NAME) continue;
      const num = parseAssistNumber(g.assist);
      if (num === null) continue;
      if (anclasNumbers.size > 0 && !anclasNumbers.has(num)) continue;
      const existing = assistCount.get(num);
      if (existing) {
        existing.assists++;
      } else {
        assistCount.set(num, {
          name: nameByNumber.get(num) ?? `#${num}`,
          number: num,
          assists: 1,
        });
      }
    }
  }

  const sorted = [...assistCount.values()].sort((a, b) => b.assists - a.assists);
  let prevAssists = -1;
  let prevRank = 0;
  return sorted.map((a, i) => {
    if (a.assists !== prevAssists) {
      prevRank = i + 1;
      prevAssists = a.assists;
    }
    return { rank: prevRank, ...a };
  });
}
