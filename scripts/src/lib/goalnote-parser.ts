import {
  ANCLAS_TEAM_NAME,
  type CardEvent,
  type GoalEvent,
  type Position,
  type ScorerRank,
  type Substitution,
} from "./types.js";

/**
 * GoalNote (goalnote.net) パーサー。
 *
 * schedule page (detail-schedule.php?tid=18626):
 *   全試合一覧。各行に 日付/時刻/ホーム/スコア/アウェイ/会場/詳細リンク。
 *
 * game page (detail-schedule-game.php?tid=18626&sid=XXXXX):
 *   試合詳細。得点経過・スタメン（背番号+ポジション+名前）・交代・警告・
 *   審判団・観客数・天候など。
 */

const BASE_URL = "https://www.goalnote.net/";
const TOURNAMENT_ID = "18626";

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export interface GoalNoteScheduleRow {
  date: string;
  kickoff: string | null;
  homeTeam: string;
  awayTeam: string;
  score: { home: number; away: number } | null;
  venue: string | null;
  gameUrl: string | null;
}

/** schedule page から全試合の会場・game URL を抽出 */
export function parseGoalNoteSchedule(html: string): GoalNoteScheduleRow[] {
  const rows: GoalNoteScheduleRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1] ?? "")) !== null) {
      cells.push(strip(td[1] ?? ""));
    }
    // 典型行: ["", "2026/04/12", "12:00", "福岡J・アンクラス", "2-2 [試合終了]", "ヴィアマテラス...", "宇美町...", "詳細"]
    const dateCell = cells.find((c) => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(c));
    if (!dateCell) continue;
    const dateIdx = cells.indexOf(dateCell);
    const kickoffCell = cells[dateIdx + 1];
    const homeCell = cells[dateIdx + 2];
    const scoreCell = cells[dateIdx + 3];
    const awayCell = cells[dateIdx + 4];
    const venueCell = cells[dateIdx + 5];
    if (!homeCell || !awayCell) continue;

    const [y, mo, d] = dateCell.split("/");
    const date = `${y}-${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    const kickoff = kickoffCell && /^\d{1,2}:\d{2}$/.test(kickoffCell) ? kickoffCell : null;

    let score: { home: number; away: number } | null = null;
    if (scoreCell) {
      const sm = scoreCell.match(/^(\d+)\s*-\s*(\d+)/);
      if (sm) score = { home: Number(sm[1]), away: Number(sm[2]) };
    }

    const linkMatch = (tr[1] ?? "").match(/href="(detail-schedule-game\.php\?[^"]+)"/);
    const gameUrl = linkMatch ? `${BASE_URL}${linkMatch[1]}` : null;

    rows.push({
      date,
      kickoff,
      homeTeam: homeCell,
      awayTeam: awayCell,
      score,
      venue: venueCell || null,
      gameUrl,
    });
  }
  return rows;
}

/** チーム名を正規化して照合キーにする（全半角・スペース・ウィ/ウイ揺れを吸収） */
function normTeam(s: string): string {
  return s
    .replace(/[\s　]/g, "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/ウイ/g, "ウィ");
}

interface EnrichableMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  venue: string | null;
  goalnoteUrl: string | null;
  status: "scheduled" | "finished";
  score: { home: number; away: number } | null;
}

/**
 * schedule page の行と matches を日付+チーム名で照合し、会場・game URL を補完する。
 * さらに GoalNote が結果を持つのに q-league が未消化（vs）の試合は、
 * GoalNote のスコアで確定扱いにする（GoalNote の方が結果反映が速いため）。
 */
export function enrichMatchesWithSchedule(
  matches: EnrichableMatch[],
  scheduleRows: GoalNoteScheduleRow[],
): void {
  const index = new Map<string, GoalNoteScheduleRow>();
  for (const r of scheduleRows) {
    index.set(`${r.date}|${normTeam(r.homeTeam)}`, r);
  }
  for (const m of matches) {
    const row = index.get(`${m.date}|${normTeam(m.homeTeam)}`);
    if (!row) continue;
    if (row.venue) m.venue = row.venue;
    if (row.gameUrl) m.goalnoteUrl = row.gameUrl;
    // q-league 未更新だが GoalNote に結果がある → 確定扱いにする
    if (m.status === "scheduled" && row.score) {
      m.status = "finished";
      m.score = row.score;
    }
  }
}

// --- game page パーサー ---

export interface MatchStats {
  attendance: string | null;
  weather: string | null;
  temperature: string | null;
  pitch: string | null;
}

export interface GoalNoteGameData {
  goals: GoalEvent[];
  starters: GoalNotePlayer[];
  subs: GoalNotePlayer[];
  substitutions: Substitution[];
  cards: CardEvent[];
  stats: MatchStats;
}

export interface GoalNotePlayer {
  number: number;
  position: Position;
  name: string;
  team: "home" | "away";
}

/** game page から得点経過を抽出 */
function parseGoals(html: string): GoalEvent[] {
  const goals: GoalEvent[] = [];
  // 「得点経過」セクション以降の行: ["30分", "福岡J・アンクラス", "11", "嘉数 クレア姫麗", "22→11S"]
  const section = html.split(/得点経過/i)[1];
  if (!section) return goals;

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(section)) !== null) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1] ?? "")) !== null) {
      cells.push(strip(td[1] ?? ""));
    }
    // 最低 ["分", "チーム名"] の2セル
    if (cells.length < 2) continue;
    const minute = cells[0] ?? "";
    const team = cells[1] ?? "";
    if (!/\d+分/.test(minute) || !team) continue;

    // OG: cells = ["30分", "福岡J...", "", "オウンゴール", ""]
    // 通常: cells = ["55分", "福岡J...", "11", "嘉数 クレア姫麗", "22→11S"]
    const numStr = cells[2] ?? "";
    const playerNumber = /^\d+$/.test(numStr) ? Number(numStr) : null;
    const playerName = cells[3] ?? cells[2] ?? "";
    const assist = cells[4] || null;

    if (!playerName) continue;
    goals.push({ minute, team, playerNumber, playerName, assist });
  }
  return goals;
}

const VALID_POSITIONS = new Set<string>(["GK", "DF", "MF", "FW", "FP"]);

/** 1つの <table> から選手行（背番号+ポジション+名前）を抽出する */
function parsePlayerTable(tableHtml: string, team: "home" | "away"): GoalNotePlayer[] {
  const players: GoalNotePlayer[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    tdRe.lastIndex = 0;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1] ?? "")) !== null) {
      cells.push(strip(td[1] ?? ""));
    }
    if (cells.length < 3) continue;
    const numStr = cells[0] ?? "";
    const posStr = (cells[1] ?? "").toUpperCase();
    const name = cells[2] ?? "";
    if (!/^\d+$/.test(numStr)) continue;
    if (!VALID_POSITIONS.has(posStr)) continue;
    if (!name) continue;
    players.push({
      number: Number(numStr),
      position: posStr as Position,
      name: name.replace(/\s*\(Cap\.\)/i, ""),
      team,
    });
  }
  return players;
}

/**
 * game page からスタメン・控えを抽出。
 *
 * GoalNote のメンバー表は <table> 単位で分かれている（実測）:
 *   選手行を含む table を順に並べると
 *   [0]=team1先発, [1]=team2先発, [2]=team1控え, [3]=team2控え
 * team1 は score-team1（KICK OFF 側）。homeTeam と照合して home/away を割り当てる。
 */
function parseLineups(html: string, homeTeam: string): { starters: GoalNotePlayer[]; subs: GoalNotePlayer[] } {
  // team1 がホームかを判定
  const team1Match = html.match(/class="score-team1"[^>]*>\s*([\s\S]*?)<(?:div|\/th)/i);
  const team1Name = team1Match ? strip(team1Match[1] ?? "") : "";
  const team1IsHome = team1Name.includes(homeTeam.slice(0, 4));

  // 選手行（ポジション略号を含む td）を持つ table だけを文書順に集める
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const playerTables: string[] = [];
  let tbl: RegExpExecArray | null;
  while ((tbl = tableRe.exec(html)) !== null) {
    const body = tbl[1] ?? "";
    if (/<td[^>]*>\s*(?:GK|DF|MF|FW|FP)\s*<\/td>/i.test(body)) {
      playerTables.push(body);
    }
  }

  const team1Side: "home" | "away" = team1IsHome ? "home" : "away";
  const team2Side: "home" | "away" = team1IsHome ? "away" : "home";

  const starters: GoalNotePlayer[] = [];
  const subs: GoalNotePlayer[] = [];
  if (playerTables[0]) starters.push(...parsePlayerTable(playerTables[0], team1Side));
  if (playerTables[1]) starters.push(...parsePlayerTable(playerTables[1], team2Side));
  if (playerTables[2]) subs.push(...parsePlayerTable(playerTables[2], team1Side));
  if (playerTables[3]) subs.push(...parsePlayerTable(playerTables[3], team2Side));

  return { starters, subs };
}

/** 1つの交代 <table> から交代を抽出（時間行→交代行の繰り返し） */
function parseSubTable(tableHtml: string, team: "home" | "away"): Substitution[] {
  const out: Substitution[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let currentMinute = "";
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    tdRe.lastIndex = 0;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1] ?? "")) !== null) cells.push(strip(td[1] ?? ""));

    if (cells.length === 1 && /\d+分|ＨＴ|HT/.test(cells[0] ?? "")) {
      currentMinute = cells[0] ?? "";
      continue;
    }
    if (cells.length === 4 && /^\d+$/.test(cells[0] ?? "") && /^\d+$/.test(cells[2] ?? "")) {
      out.push({
        minute: currentMinute,
        team,
        outNumber: Number(cells[0]),
        outName: (cells[1] ?? "").replace(/\s*\(Cap\.\)/i, ""),
        inNumber: Number(cells[2]),
        inName: (cells[3] ?? "").replace(/\s*\(Cap\.\)/i, ""),
      });
    }
  }
  return out;
}

/**
 * game page から選手交代を抽出。
 * 交代は <table> 単位でチーム別に分かれている（team1=KICK OFF 側 → team2）。
 * 交代行 [OUT番号, OUT名, IN番号, IN名] を含む table を文書順に集め、
 * [0]=team1, [1]=team2 として home/away を割り当てる。
 */
function parseSubstitutions(html: string, homeTeam: string): Substitution[] {
  const team1Match = html.match(/class="score-team1"[^>]*>\s*([\s\S]*?)<(?:div|\/th)/i);
  const team1Name = team1Match ? strip(team1Match[1] ?? "") : "";
  const team1IsHome = team1Name.includes(homeTeam.slice(0, 4));

  // 交代行は OUT/IN の間に <th class="change"> 矢印マーカーを持つ。それを含む table を集める
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const subTables: string[] = [];
  let tbl: RegExpExecArray | null;
  while ((tbl = tableRe.exec(html)) !== null) {
    const body = tbl[1] ?? "";
    if (/class="change"/.test(body)) subTables.push(body);
  }

  const team1Side: "home" | "away" = team1IsHome ? "home" : "away";
  const team2Side: "home" | "away" = team1IsHome ? "away" : "home";

  const subs: Substitution[] = [];
  if (subTables[0]) subs.push(...parseSubTable(subTables[0], team1Side));
  if (subTables[1]) subs.push(...parseSubTable(subTables[1], team2Side));
  return subs;
}

/** game page から試合情報（観客数・天候・気温・ピッチ状態）を抽出 */
function parseStats(html: string): MatchStats {
  const stats: MatchStats = { attendance: null, weather: null, temperature: null, pitch: null };
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    tdRe.lastIndex = 0;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1] ?? "")) !== null) {
      cells.push(strip(td[1] ?? ""));
    }
    if (cells.length < 2) continue;
    const label = cells[0] ?? "";
    const value = cells[1] ?? "";
    if (/^観客$/.test(label)) stats.attendance = value;
    else if (/^天候$/.test(label)) stats.weather = value;
    else if (/^気温$/.test(label)) stats.temperature = value;
    else if (/^ピッチ状態$/.test(label)) stats.pitch = value;
  }
  return stats;
}

/**
 * game page から警告・退場を抽出する。
 * カード行は [背番号, 名前, "", カード種別(ラフ/警告/退場 等)] の形式。
 * 所属チームは選手の背番号をメンバー表と突き合わせて判定する。
 */
function parseCards(html: string, lineup: GoalNotePlayer[]): CardEvent[] {
  // 番号は両チームで重複するため、番号+名前で所属を引く
  const norm = (s: string) => s.replace(/[\s　]/g, "");
  const teamByKey = new Map<string, "home" | "away">();
  for (const p of lineup) teamByKey.set(`${p.number}-${norm(p.name)}`, p.team);

  const cards: CardEvent[] = [];
  const seen = new Set<string>();
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    tdRe.lastIndex = 0;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1] ?? "")) !== null) cells.push(strip(td[1] ?? ""));
    if (cells.length < 4) continue;
    const numStr = cells[0] ?? "";
    const name = cells[1] ?? "";
    const third = cells[2] ?? "";
    const kind = cells[3] ?? "";
    // カード行: [番号, 名前, 空, 種別]。種別がカード系キーワードのみ採用
    if (!/^\d+$/.test(numStr)) continue;
    if (third !== "") continue;
    if (!/ラフ|警告|遅延|退場|レッド|イエロー|２枚|2枚/.test(kind)) continue;
    if (!name || /^\d+$/.test(name)) continue;

    const number = Number(numStr);
    const type: "yellow" | "red" = /退場|レッド|２枚|2枚/.test(kind) ? "red" : "yellow";
    const key = `${number}-${name}-${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cleanName = name.replace(/\s*\(Cap\.\)/i, "");
    cards.push({
      number,
      name: cleanName,
      team: teamByKey.get(`${number}-${norm(cleanName)}`) ?? "home",
      type,
    });
  }
  return cards;
}

/** game page から試合詳細を抽出 */
export function parseGoalNoteGame(html: string, homeTeam: string): GoalNoteGameData {
  const lineups = parseLineups(html, homeTeam);
  const allPlayers = [...lineups.starters, ...lineups.subs];
  return {
    goals: parseGoals(html),
    ...lineups,
    substitutions: parseSubstitutions(html, homeTeam),
    cards: parseCards(html, allPlayers),
    stats: parseStats(html),
  };
}

/** GoalNote の schedule page を取得 */
export async function fetchGoalNoteSchedule(tid: string = TOURNAMENT_ID): Promise<string> {
  const url = `${BASE_URL}detail-schedule.php?tid=${tid}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "anclas-port-pipeline (+https://github.com/atani/anclas-port-data)" },
  });
  if (!res.ok) throw new Error(`GoalNote schedule fetch failed: ${res.status}`);
  return res.text();
}

/**
 * 得点ランキングページからアンクラス選手の得点ランキングを抽出する。
 * テーブル: [順位, 選手名, チーム名, 得点]。アンクラスの選手のみ返す。
 * number は playerNumberByName で名前→背番号を補完（無ければ null）。
 */
export function parseScorerRanking(
  html: string,
  playerNumberByName: Map<string, number>,
): ScorerRank[] {
  const norm = (s: string) => s.replace(/[\s　]/g, "");
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];
  const rows = tableMatch[1]?.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const scorers: ScorerRank[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      strip(m[1] ?? ""),
    );
    if (cells.length < 4) continue;
    const rank = Number(cells[0]);
    const name = cells[1] ?? "";
    const team = cells[2] ?? "";
    const goals = Number(cells[3]);
    if (!Number.isFinite(rank) || !Number.isFinite(goals)) continue;
    if (team !== ANCLAS_TEAM_NAME) continue;
    scorers.push({
      rank: 0, // 後でチーム内順位を振り直す
      leagueRank: rank,
      name,
      number: playerNumberByName.get(norm(name)) ?? null,
      goals,
    });
  }
  // チーム内順位を得点数の降順で振り直す（同点同位）
  scorers.sort((a, b) => b.goals - a.goals);
  let prevGoals = -1;
  let prevRank = 0;
  for (let i = 0; i < scorers.length; i++) {
    const cur = scorers[i]!;
    if (cur.goals !== prevGoals) {
      prevRank = i + 1;
      prevGoals = cur.goals;
    }
    cur.rank = prevRank;
  }
  return scorers;
}

/** GoalNote の得点ランキングページを取得 */
export async function fetchGoalNoteRanking(tid: string = TOURNAMENT_ID): Promise<string> {
  const url = `${BASE_URL}detail-ranking.php?tid=${tid}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "anclas-port-pipeline (+https://github.com/atani/anclas-port-data)" },
  });
  if (!res.ok) throw new Error(`GoalNote ranking fetch failed: ${res.status}`);
  return res.text();
}

/** GoalNote の game page を取得 */
export async function fetchGoalNoteGame(gameUrl: string): Promise<string> {
  const res = await fetch(gameUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "anclas-port-pipeline (+https://github.com/atani/anclas-port-data)" },
  });
  if (!res.ok) throw new Error(`GoalNote game fetch failed: ${res.status} ${gameUrl}`);
  return res.text();
}

/** アンクラス選手のポジションを GoalNote の最新スタメン情報から逆引きする */
export function buildPositionMap(
  allStarters: GoalNotePlayer[],
): Map<number, Position> {
  const map = new Map<number, Position>();
  for (const p of allStarters) {
    if (p.team === "home" || p.team === "away") {
      // 最新の出場が優先されるよう上書き
      map.set(p.number, p.position);
    }
  }
  return map;
}
