import { ANCLAS_TEAM_NAME, type Match, type MatchStatus } from "./types.js";

/**
 * q-league.net/match/ の HTML 構造（実測）:
 *   <h1>日程・結果</h1>               ← アンクラス所属リーグのセクション（部表記なし）
 *     <h4>1節</h4> ... <h4>17節</h4>  ← 節
 *       <ul class="su-posts su-posts-list-loop ">
 *         <li id="su-post-9354" class="su-post ">
 *           <a href="https://q-league.net/qleague/match_xxx/">
 *             2026/04/12 12:00 福岡J・アンクラス 【2-2】ヴィアマテラス宮崎Alegrita
 *           </a>
 *         </li>
 *       </ul>
 *   <h1>1部　日程表・順位表</h1>       ← 別の下部リーグ（アンクラス不在）
 *   <h1>2部　日程表・順位表</h1>
 *
 * 同一ページに複数リーグが縦に並ぶため「N部」では判定できない。
 * アンクラスの試合が含まれる H1 セクションだけを対象リーグとして抽出する。
 *
 * 区切りはタブ/全角スペース/半角スペースが混在し、チーム名とスコアの間や
 * 時刻とチーム名の間（"11:00八女学院" のように区切り無し）も揺れるため、
 * 空白を `[\s　]` で吸収する。チーム名内部の全角スペース
 * （例: "東海大学付属福岡高等学校　女子サッカー部"）は保持する。
 */

const WS = "[\\s\\u3000]";

/** HTMLエンティティを最小限デコードする */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** タグを除去してプレーンテキスト化する */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

/** 全角英数字を半角化する（"ＦＣ琉球" → "FC琉球", "１" → "1"） */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * チーム名の表記揺れを正規化する。
 * 「学」の有無（東海大付属 ↔ 東海大学付属）はスペース・全半角の正規化では
 * 吸収できないため、別名マップで代表名へ寄せる。
 */
const TEAM_ALIASES: Record<string, string> = {
  東海大付属福岡高等学校: "東海大学付属福岡高等学校",
  東海大学付属福岡高等学校: "東海大学付属福岡高等学校",
  東海大付属福岡高等学校女子サッカー部: "東海大学付属福岡高等学校",
  東海大学付属福岡高等学校女子サッカー部: "東海大学付属福岡高等学校",
};

export function normalizeTeamName(raw: string): string {
  let s = decodeEntities(raw).trim();
  // 先頭に紛れ込む「（調整中）」や時刻トークンを除去
  s = s.replace(/^[（(]\s*調整中\s*[)）][\s　]*/u, "");
  s = s.replace(/^\d{1,2}[:：]\d{2}[\s　]*/u, "");
  s = toHalfWidth(s).trim();
  const key = s.replace(/[\s　]/gu, "");
  return TEAM_ALIASES[key] ?? s;
}

/** 見出しテキストから「N節」を取り出す */
function parseRoundHeading(text: string): number | null {
  const m = toHalfWidth(text).match(/(\d+)\s*節/u);
  return m && m[1] ? Number(m[1]) : null;
}

interface ParsedLine {
  date: string;
  kickoff: string | null;
  homeTeam: string;
  awayTeam: string;
  status: MatchStatus;
  score: { home: number; away: number } | null;
}

/**
 * `<a>` のプレーンテキストを構造化する。
 *   "2026/04/12 12:00 福岡J・アンクラス 【2-2】ヴィアマテラス宮崎Alegrita"
 *   "2026/11/07 11:00八女学院女子サッカー部【vs】琉球デイゴス"（時刻直結）
 *   "2026/09/12 （調整中） 秀岳館高等学校【vs】琉球デイゴス"（時刻未定）
 */
export function parseMatchLine(text: string): ParsedLine | null {
  const t = decodeEntities(text).replace(/ /g, " ").trim();
  const re = new RegExp(
    `^(\\d{4})/(\\d{1,2})/(\\d{1,2})${WS}+` + // 日付
      `(?:(\\d{1,2})[:：](\\d{2}))?${WS}*` + // 時刻（任意・直後の区切りは0個以上）
      `(.+?)${WS}*【(.+?)】${WS}*(.+?)$`, // ホーム 【スコア/vs】 アウェイ
    "u",
  );
  const m = t.match(re);
  if (!m) return null;

  const [, y, mo, d, hh, mm, homeRaw, scoreRaw, awayRaw] = m;
  const date = `${y}-${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  const kickoff = hh && mm ? `${String(Number(hh)).padStart(2, "0")}:${mm}` : null;

  const homeTeam = normalizeTeamName(homeRaw ?? "");
  const awayTeam = normalizeTeamName(awayRaw ?? "");
  if (!homeTeam || !awayTeam) return null;

  const scoreMatch = (scoreRaw ?? "").trim().match(/^(\d+)\s*[-–]\s*(\d+)$/u);
  if (scoreMatch) {
    return {
      date,
      kickoff,
      homeTeam,
      awayTeam,
      status: "finished",
      score: { home: Number(scoreMatch[1]), away: Number(scoreMatch[2]) },
    };
  }
  return { date, kickoff, homeTeam, awayTeam, status: "scheduled", score: null };
}

/** date(YYYY-MM-DD) + kickoff(HH:MM|null) → JST固定のISO8601 */
function toIsoJst(date: string, kickoff: string | null): string {
  return `${date}T${kickoff ?? "00:00"}:00+09:00`;
}

interface SectionedMatch extends Match {
  /** 所属セクション（直近の H1 テキスト）。リーグ判定用の内部値 */
  section: string;
}

/** 文書順にトークン（H1/H4見出し・su-posts ul）を走査し、全試合を section 付きで集める */
function collectAllMatches(html: string, competition: string): SectionedMatch[] {
  const tokenRe =
    /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>|<ul[^>]*class="[^"]*su-posts[^"]*"[^>]*>([\s\S]*?)<\/ul>/g;
  const liRe = /<li[^>]*id="(su-post-\d+)"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  const out: SectionedMatch[] = [];
  let currentSection = "";
  let currentRound: number | null = null;

  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(html)) !== null) {
    const level = token[1];
    const headingHtml = token[2];
    const ulHtml = token[3];

    if (headingHtml !== undefined) {
      const text = stripTags(headingHtml).trim();
      if (level === "1") {
        currentSection = text;
        currentRound = null;
      } else {
        const round = parseRoundHeading(text);
        if (round !== null) currentRound = round;
      }
      continue;
    }

    if (ulHtml === undefined) continue;
    let li: RegExpExecArray | null;
    liRe.lastIndex = 0;
    while ((li = liRe.exec(ulHtml)) !== null) {
      const [, id, href, anchorHtml] = li;
      const parsed = parseMatchLine(stripTags(anchorHtml ?? ""));
      if (!parsed || !id) continue;
      const isAnclas =
        parsed.homeTeam === ANCLAS_TEAM_NAME || parsed.awayTeam === ANCLAS_TEAM_NAME;
      out.push({
        id,
        competition,
        round: currentRound,
        date: parsed.date,
        kickoff: parsed.kickoff,
        datetime: toIsoJst(parsed.date, parsed.kickoff),
        homeTeam: parsed.homeTeam,
        awayTeam: parsed.awayTeam,
        status: parsed.status,
        score: parsed.score,
        isAnclas,
        sourceUrl: href ?? "",
        venue: null,
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
        section: currentSection,
      });
    }
  }
  return out;
}

/**
 * アンクラスが所属するリーグの全試合を抽出する。
 * 同一ページ内の複数リーグから「アンクラスの試合を含むセクション」だけを残す。
 */
export function parseQLeagueMatches(html: string, options: { competition?: string } = {}): Match[] {
  const competition = options.competition ?? "Qリーグ";
  const all = collectAllMatches(html, competition);

  const anclasSections = new Set(all.filter((m) => m.isAnclas).map((m) => m.section));
  const matches: Match[] = all
    .filter((m) => anclasSections.has(m.section))
    .map(({ section: _section, ...m }) => m);

  matches.sort((a, b) => {
    if (a.datetime !== b.datetime) return a.datetime < b.datetime ? -1 : 1;
    return (a.round ?? 0) - (b.round ?? 0);
  });
  return matches;
}
