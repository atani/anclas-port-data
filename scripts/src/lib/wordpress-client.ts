/**
 * anclas.jp の取得クライアント。
 * ニュース・試合まわりは WordPress REST API を使い、
 * REST API が拒否される選手・スタッフは公開ページのHTMLから取得する。
 */

import { fetchSearchFeedPosts, fetchSearchResultCards } from "./anclas-search.js";
import { logger } from "./logger.js";
import { parsePlayerBlogCards, toPlayerBlogEntries } from "./player-parser.js";
import type { PlayerBlogEntry } from "./player-parser.js";
import { toIsoJst } from "./qleague-parser.js";
import type { BlogPost, MatchReport } from "./types.js";

const SITE_URL = "https://anclas.jp";
const BASE_URL = `${SITE_URL}/wp-json/wp/v2`;
const WP_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline/1.0; +https://github.com/atani/anclas-port)",
};

export interface WPMediaSize {
  source_url: string;
  width: number;
  height: number;
}

export interface WPMedia {
  source_url: string;
  media_details?: {
    sizes?: Record<string, WPMediaSize>;
  };
}

export interface WPPost {
  id: number;
  date: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  link: string;
  categories: number[];
  tags: number[];
  featured_media: number;
  _embedded?: {
    "wp:featuredmedia"?: WPMedia[];
  };
}

export interface WPCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

const ALLOWED_PATHS = ["/posts", "/categories", "/tags"] as const;

/**
 * REST API が使えないことが分かった時点で立てるフラグ。
 * anclas.jp はデータセンター系IPからの `/wp-json/` を拒否するため、
 * 一度失敗したら残りの取得も同じ結果になる。試合ごとに403を踏み直さず公開経路へ切り替える。
 */
let wpApiBlocked = false;

/**
 * REST API を使わない経路だけで動くことを確かめるための強制無効化。
 * GitHub Actions で起きる403をローカルで再現する用途に使う。
 */
function isWpApiDisabled(): boolean {
  return process.env.ANCLAS_WP_API_DISABLED === "1";
}

/** REST API が現時点で使える見込みかどうか。 */
export function isWpApiAvailable(): boolean {
  return !isWpApiDisabled() && !wpApiBlocked;
}

/** 遮断フラグを戻す（テストで経路ごとの要求回数を確かめるために使う）。 */
export function resetWpApiBlockedState(): void {
  wpApiBlocked = false;
}

/**
 * REST API への唯一の出口。
 * 無効化・遮断の判定と、失敗時のフラグ設定をここへ集約する。
 */
async function wpApiFetch(url: string): Promise<Response> {
  if (isWpApiDisabled()) {
    throw new Error("WordPress API error: 403 Forbidden - ANCLAS_WP_API_DISABLED により無効化されています");
  }
  if (wpApiBlocked) {
    throw new Error("WordPress API error: 403 Forbidden - 同一実行で遮断済みのため要求しません");
  }
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: WP_HEADERS });
  } catch (e) {
    wpApiBlocked = true;
    throw e;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    wpApiBlocked = true;
    throw new Error(`WordPress API error: ${res.status} ${res.statusText} - ${body.slice(0, 120)}`);
  }
  return res;
}

async function wpFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!ALLOWED_PATHS.some((p) => path === p)) {
    throw new Error(`Invalid API path: ${path}`);
  }
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await wpApiFetch(url.toString());
  return res.json() as Promise<T>;
}

async function siteFetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: WP_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`Official site error: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** 公式サイトの選手一覧ページ。シーズンと各選手の個別ページURLを含む。 */
export async function getPlayerArchiveHtml(): Promise<string> {
  return siteFetchText(`${SITE_URL}/player/`);
}

/** 選手個別ページ。背番号・プロフィール・顔写真を含む。 */
export async function getPlayerPageHtml(url: string): Promise<string> {
  return siteFetchText(url);
}

/** 公式スタッフ紹介ページ。個別詳細ページを持たないカード一覧を取得する。 */
export async function getStaffPageHtml(): Promise<string> {
  return siteFetchText(`${SITE_URL}/staff`);
}

export async function getPosts(params: {
  categories?: number[];
  tags?: number[];
  search?: string;
  perPage?: number;
  page?: number;
  orderby?: string;
  order?: "asc" | "desc";
  embed?: boolean;
} = {}): Promise<WPPost[]> {
  const query: Record<string, string> = {
    per_page: String(params.perPage ?? 10),
    page: String(params.page ?? 1),
    orderby: params.orderby ?? "date",
    order: params.order ?? "desc",
  };
  if (params.categories?.length) query.categories = params.categories.join(",");
  if (params.tags?.length) query.tags = params.tags.join(",");
  if (params.search) query.search = params.search;
  if (params.embed) query._embed = "1";
  return wpFetch<WPPost[]>("/posts", query);
}

export async function getCategories(): Promise<WPCategory[]> {
  return wpFetch<WPCategory[]>("/categories", { per_page: "100" });
}

/**
 * 全文検索で投稿を引く。
 * REST API が拒否された場合は、同じ検索語・同じ並び順で1ページ10件を返す検索RSSへ切り替える。
 * ニュース生成と同じく、公開経路だけで結果が揃うようにするためのフォールバック。
 */
export async function searchPosts(search: string): Promise<WPPost[]> {
  if (isWpApiAvailable()) {
    try {
      return await getPosts({ search, perPage: 10, order: "desc" });
    } catch (e) {
      logger.warn(
        `WordPress REST APIで検索できないため検索RSSを使用します: ${e instanceof Error ? e.message.slice(0, 120) : e}`,
      );
    }
  }
  return fetchSearchFeedPosts(search);
}

/** リニューアル前後で重複した「お知らせ」カテゴリをすべて選ぶ。 */
export function selectNewsCategories(categories: WPCategory[]): WPCategory[] {
  return categories
    .filter((category) => category.name === "お知らせ" && category.count > 0)
    .sort((a, b) => b.count - a.count || a.id - b.id);
}

/** 通常ニュースに共通して付与される ALL NEWS カテゴリを選ぶ。 */
export function selectAllNewsCategory(categories: WPCategory[]): WPCategory | null {
  return categories
    .filter(
      (category) =>
        category.count > 0
        && (category.name === "ALL NEWS" || category.slug === "all"),
    )
    .sort((a, b) => b.count - a.count || a.id - b.id)[0] ?? null;
}

/** 告知ポスターとして採用する投稿かどうか（タイトルの種別と対戦相手名で判定）。 */
function isPosterAnnouncement(title: string, shortName: string): boolean {
  return /開催情報|試合情報/.test(title) && title.includes(shortName);
}

/** 告知ポスターの対象期間（試合日の30日前から試合日まで）。 */
function posterDateRange(matchDate: string): { from: string; to: string } {
  const from = new Date(matchDate);
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: matchDate };
}

/**
 * 検索結果HTMLの記事カードから告知ポスターを探す。
 * アイキャッチ画像はRSSに含まれないため、REST API が使えない場合はこの経路だけが残る。
 * カードは公開日を日付までしか持たないため、REST API 経由と違い日付の文字列比較で絞り込む。
 */
async function findMatchPosterFromCards(
  opponentName: string,
  matchDate: string,
): Promise<string | null> {
  const shortName = opponentName.slice(0, 4);
  const { from, to } = posterDateRange(matchDate);
  for (const card of await fetchSearchResultCards(opponentName)) {
    if (!isPosterAnnouncement(card.title, shortName)) continue;
    if (card.date < from || card.date > to) continue;
    if (card.imageUrl) return card.imageUrl;
  }
  return null;
}

/**
 * 次節の告知ポスターを探す。
 * 投稿日が試合日の30日前以内の「開催情報」投稿のみを対象にする。
 * 古い試合の告知ポスターを誤って返さないための日付ガード。
 */
export async function findMatchPoster(opponentName: string, matchDate: string): Promise<string | null> {
  if (isWpApiAvailable()) {
    try {
      const posts = await getPosts({ search: opponentName, perPage: 10, embed: true, order: "desc" });
      const shortName = opponentName.slice(0, 4);
      const matchMs = new Date(matchDate).getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      for (const p of posts) {
        const title = p.title.rendered;
        if (!isPosterAnnouncement(title, shortName)) continue;
        const postMs = new Date(p.date).getTime();
        if (postMs < matchMs - thirtyDaysMs || postMs > matchMs) continue;
        const media = p._embedded?.["wp:featuredmedia"]?.[0];
        if (media?.source_url) return media.source_url;
      }
      return null;
    } catch (e) {
      logger.warn(
        `WordPress REST APIでポスターを取得できないため検索結果HTMLを使用します: ${e instanceof Error ? e.message.slice(0, 120) : e}`,
      );
    }
  }
  try {
    return await findMatchPosterFromCards(opponentName, matchDate);
  } catch (e) {
    logger.warn(`ポスター検索失敗（検索結果HTML）: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return null;
  }
}

export interface RescheduleInfo {
  date: string;
  kickoff: string;
  venue: string | null;
  sourceUrl: string;
}

/** API取得を優先し、取得できない場合だけ確認済みキャッシュへフォールバックする。 */
export function selectRescheduleInfo(
  matchId: string,
  discovered: RescheduleInfo | null,
  verified: Record<string, RescheduleInfo>,
): RescheduleInfo | null {
  return discovered ?? verified[matchId] ?? null;
}

/**
 * 告知本文から日付・キックオフ時刻を抽出する。
 * anclas.jp の告知は「日　　時：2026年9月5日(日)18：00 キックオフ」のようにラベルと値が
 * コロンで同じ行に並ぶ書式と、「日時」ラベルの後に別段落で「2026 年 7 月 12 日 (日)　16：00キックオフ」
 * と数字の間にスペースが入る書式の2種類が実在するため、コロン・改行・数字周りの空白をすべて任意とする。
 */
export function parseAnnouncementDateTime(text: string): { date: string; kickoff: string } | null {
  const m = text.match(
    /日\s*時\s*[:：]?\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^0-9]*?(\d{1,2})\s*[:：]\s*(\d{1,2})/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return {
    date: `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`,
    kickoff: `${h!.padStart(2, "0")}:${mi!.padStart(2, "0")}`,
  };
}

/**
 * 告知本文から会場名を抽出する（住所は含めない）。
 * 「会　　場：Arrivo!南島原(南島原多目的運動広場)〈住所〉」のような同じ行にラベル・値・住所（〈〉）
 * が並ぶ書式と、「試合会場」ラベルの後に別段落で値が続く書式の両方に対応する。
 */
export function parseAnnouncementVenue(text: string): string | null {
  const m = text.match(/(?:試合)?会\s*場\s*[:：]?\s*([^\n〈≪]+)/);
  return m?.[1]?.trim() ?? null;
}

/** 代替試合情報の検索に使う、対戦相手名の表記ゆれを吸収したキー候補（学校種別等の接尾辞を除去） */
function opponentSearchKeys(opponentName: string): string[] {
  const key = opponentName
    .replace(/女子サッカー部|高等学校|高等部|高校|大学|レディース|FC/g, "")
    .replace(/[\s・　]/g, "");
  return [...new Set([
    key.slice(0, 4),
    key.slice(0, 3),
    opponentName.slice(0, 4),
  ].filter((k) => k.length >= 2))];
}

/**
 * 延期・振替待ちの試合について、代替日程の告知投稿から確定日程を探す。
 * 「代替試合情報」の見出しを持つ投稿のみを対象にし、通常の開催告知（延期前の日程）
 * を誤って再取得しないよう、投稿日（日付のみ比較。時刻情報は書式間で不統一なため使わない）が
 * 延期前の元日程以降のものに限定する。延期が数ヶ月に渡り長期化するケースを見込み、
 * 元日程から半年以内の投稿までを対象にする。
 */
export async function findRescheduleInfo(
  opponentName: string,
  originalMatchDate: string,
): Promise<RescheduleInfo | null> {
  try {
    const postMap = new Map<string, WPPost>();
    for (const key of opponentSearchKeys(opponentName)) {
      for (const post of await searchPosts(key)) postMap.set(post.link, post);
    }
    const posts = [...postMap.values()].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const latestAllowedDate = new Date(originalMatchDate);
    latestAllowedDate.setDate(latestAllowedDate.getDate() + 180);
    const latestAllowed = latestAllowedDate.toISOString().slice(0, 10);

    for (const p of posts) {
      const postDate = p.date.slice(0, 10);
      if (postDate < originalMatchDate || postDate > latestAllowed) continue;
      const text = htmlToPlainText(p.content.rendered);
      if (!/代替試合情報/.test(text)) continue;
      const dt = parseAnnouncementDateTime(text);
      if (!dt) continue;
      return { ...dt, venue: parseAnnouncementVenue(text), sourceUrl: p.link };
    }
  } catch (e) {
    logger.warn(`延期試合の代替日程告知検索失敗: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  }
  return null;
}

export interface ReschedulableMatch {
  date: string;
  kickoff: string | null;
  datetime: string;
  venue: string | null;
}

/**
 * 延期試合の代替日程告知を試合データへ反映する。
 * 日付・キックオフのいずれも変わっていなければ何もしない（再取得のたびに更新扱いにしない）。
 */
export function applyRescheduleInfo(m: ReschedulableMatch, info: RescheduleInfo): boolean {
  if (info.date === m.date && info.kickoff === m.kickoff) return false;
  m.date = info.date;
  m.kickoff = info.kickoff;
  m.datetime = toIsoJst(info.date, info.kickoff);
  if (info.venue) m.venue = info.venue;
  return true;
}

/** HTMLをプレーンテキストに変換 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/?(div|li|tr|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ReportedGoal {
  minute: string;
  playerNumber: number | null;
  playerName: string;
}

/**
 * 公式マッチレポートの「得点 / 交代」にある得点行を抽出する。
 * GoalNote の得点経過が空の場合に限り、無失点試合の補完へ使用する。
 */
export function parseReportedGoals(html: string): ReportedGoal[] {
  const text = htmlToPlainText(html);
  const lines = [...text.matchAll(/得点[：:]\s*([^\n]+)/g)]
    .map((match) => match[1]?.trim() ?? "");
  const line = [...lines].reverse().find(
    (entry: string) => /(?:前半|後半)\d+(?:\+\d+)?分/.test(entry),
  )
    ?? lines.at(-1);
  if (!line) return [];
  const entries = /(?:前半|後半)\d+(?:\+\d+)?分/.test(line)
    ? line.split(/[、,]/)
    : line.split(/[、,]|(?=[#＃])/);

  return entries.flatMap((entry): ReportedGoal[] => {
    const normalized = entry.trim().replace(/\s+/g, " ");
    const timing = normalized.match(/^(前半|後半)(\d+)(?:\+(\d+))?分\s*(.*)$/);
    const period = timing?.[1];
    const baseMinute = Number(timing?.[2] ?? 0);
    const addedMinute = Number(timing?.[3] ?? 0);
    const totalMinute = (period === "後半" ? 40 : 0) + baseMinute;
    const minute = timing
      ? (addedMinute > 0 ? `${totalMinute}+${addedMinute}分` : `${totalMinute}分`)
      : "時間不明";
    const scorer = (timing?.[4] ?? normalized).trim();
    const countMatch = scorer.match(/[×xX]\s*(\d+)\s*$/);
    const count = Number(countMatch?.[1] ?? 1);
    const scorerWithoutCount = scorer.replace(/[×xX]\s*\d+\s*$/, "").trim();

    if (/オウンゴール/.test(scorerWithoutCount)) {
      return Array.from(
        { length: count },
        () => ({ minute, playerNumber: null, playerName: "オウンゴール" }),
      );
    }

    const numberedPlayer = scorerWithoutCount.match(/^[#＃](\d+)\s*(.+)$/);
    const unnumberedPlayer = scorerWithoutCount.match(/^[#＃]?\s*(.+)$/);
    const playerName = numberedPlayer?.[2]?.trim() ?? unnumberedPlayer?.[1]?.trim();
    if (!playerName) return [];
    return Array.from(
      { length: count },
      () => ({
        minute,
        playerNumber: numberedPlayer ? Number(numberedPlayer[1]) : null,
        playerName,
      }),
    );
  });
}

/** マッチレポート本文からコメントを抽出 */
function parseMatchReportContent(html: string, postUrl: string): MatchReport {
  const text = htmlToPlainText(html);

  // 記事冒頭は INDEX（目次リンク）と試合メタ情報。「公式記録」以降を本文領域とし、
  // 目次内の「マッチレポート」「#N…コメント」を誤って拾わないようにする。
  const officialIdx = text.indexOf("公式記録");
  const afterOfficial = officialIdx >= 0 ? text.slice(officialIdx) : text;

  // 本文の「マッチレポート」見出し以降（公式記録の登録メンバー・得点/交代は除外）
  const repStart = afterOfficial.search(/(?:^|\n)\s*マッチレポート\s*\n/);
  let reportText = repStart >= 0 ? afterOfficial.slice(repStart) : afterOfficial;

  // 終端「フォトギャラリー」以降を切り捨てる
  reportText = reportText.split(/\n\s*フォトギャラリー/)[0] ?? reportText;

  // コメントセクションを分割: 「監督 XXX コメント」「#N選手名 コメント」
  const commentPattern = /(?:監督\s+.+?\s*コメント|#\d+\s*.+?\s*コメント)/g;
  const commentHeaders: { index: number; header: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = commentPattern.exec(reportText)) !== null) {
    commentHeaders.push({ index: m.index, header: m[0] });
  }

  // レポート本文: マッチレポート見出しから最初のコメントまで
  const summaryEnd = commentHeaders.length > 0 ? commentHeaders[0]!.index : reportText.length;
  const summaryRaw = reportText.slice(0, summaryEnd);
  const summary = summaryRaw
    .replace(/^\s*マッチレポート\s*\n/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 監督コメント
  let coachComment: MatchReport["coachComment"] = null;
  const playerComments: MatchReport["playerComments"] = [];

  for (let i = 0; i < commentHeaders.length; i++) {
    const header = commentHeaders[i]!;
    const start = header.index + header.header.length;
    const end = i + 1 < commentHeaders.length ? commentHeaders[i + 1]!.index : reportText.length;
    const body = reportText.slice(start, end).trim();

    const coachMatch = header.header.match(/監督\s+(.+?)\s*コメント/);
    if (coachMatch) {
      coachComment = { name: coachMatch[1]!.trim(), comment: body };
      continue;
    }

    const playerMatch = header.header.match(/#(\d+)\s*(.+?)\s*コメント/);
    if (playerMatch) {
      playerComments.push({
        name: playerMatch[2]!.trim(),
        number: Number(playerMatch[1]),
        comment: body,
      });
    }
  }

  return { summary, coachComment, playerComments, sourceUrl: postUrl };
}

/**
 * マッチレポート投稿の content からフォトギャラリー画像URLを抽出する。
 * 末尾の「フォトギャラリー」見出し以降の uploads 画像を集め、サイズ違い・
 * プロフィール写真・ロゴを除いて重複排除する。
 */
function parseGalleryImages(html: string): string[] {
  const galleryIdxs = [...html.matchAll(/フォトギャラリー/g)].map((m) => m.index ?? 0);
  const region = galleryIdxs.length > 0 ? html.slice(galleryIdxs[galleryIdxs.length - 1]) : html;
  const urls = [...region.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1] ?? "");

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    if (!/wp-content\/uploads\//.test(raw)) continue;
    if (/笑顔|監督|ロゴ|logo|icon|アイコン|banner|バナー/i.test(raw)) continue;
    // サイズ違い（-300x200 等）を除いた base で重複排除
    const base = raw.replace(/-\d+x\d+(?=\.[a-z]+$)/i, "");
    if (seen.has(base)) continue;
    seen.add(base);
    result.push(base);
  }
  return result;
}

export interface MatchReportResult {
  report: MatchReport;
  photoGallery: string[];
  reportedGoals: ReportedGoal[];
}

/**
 * マッチレポート投稿を探してコメントとフォトギャラリーを抽出する。
 * 投稿日が試合日の前後7日以内の「マッチレポート」投稿を対象にする。
 */
export async function findMatchReport(
  opponentName: string,
  matchDate: string,
): Promise<MatchReportResult | null> {
  try {
    const opponentKey = opponentName
      .replace(/女子サッカー部|高等学校|高等部|高校|大学|レディース|FC/g, "")
      .replace(/[\s・　]/g, "");
    const searchKeys = [...new Set([
      opponentKey.slice(0, 4),
      opponentKey.slice(0, 3),
      opponentName.slice(0, 4),
    ].filter((key) => key.length >= 2))];
    const postMap = new Map<string, WPPost>();
    for (const key of searchKeys) {
      for (const post of await searchPosts(`マッチレポート ${key}`)) postMap.set(post.link, post);
    }
    const matchMs = new Date(matchDate).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    // 学校名は記事タイトル側で「東海大学」→「東海大」のように省略される。
    // 投稿日の近さと後段の得点数も照合するため、タイトルは先頭2文字で候補を絞る。
    const titleMatchLength = (post: WPPost): number => {
      const title = decodeEntities(post.title.rendered).replace(/[\s・　]/g, "");
      let length = 0;
      while (
        length < opponentKey.length &&
        title.includes(opponentKey.slice(0, length + 1))
      ) {
        length++;
      }
      return length;
    };
    const posts = [...postMap.values()].sort((a, b) => {
      const matchLengthDifference = titleMatchLength(b) - titleMatchLength(a);
      if (matchLengthDifference !== 0) return matchLengthDifference;
      return (
        Math.abs(new Date(a.date).getTime() - matchMs) -
        Math.abs(new Date(b.date).getTime() - matchMs)
      );
    });

    for (const p of posts) {
      const title = decodeEntities(p.title.rendered).replace(/[\s・　]/g, "");
      if (!/マッチレポート/.test(title)) continue;
      if (titleMatchLength(p) < 2) continue;
      const postMs = new Date(p.date).getTime();
      if (Math.abs(postMs - matchMs) > sevenDaysMs) continue;
      return {
        report: parseMatchReportContent(p.content.rendered, p.link),
        photoGallery: parseGalleryImages(p.content.rendered),
        reportedGoals: parseReportedGoals(p.content.rendered),
      };
    }
  } catch (e) {
    logger.warn(`マッチレポート検索失敗: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  }
  return null;
}

/**
 * 選手ブログ一覧の巡回上限。
 * 1ページ10件で、2026年9月時点の全407件は41ページに収まる。
 * 打ち切り条件が効かなかった場合でも要求が際限なく増えないようにする。
 */
const PLAYER_BLOG_MAX_PAGES = 60;

/**
 * 選手ブログ記事を全件取得し、背番号＋名前付きで返す。
 * 紐付け側で名前照合できるよう、背番号だけでなくタイトル内の選手名も抽出する。
 * これにより背番号が変わっても安全に紐付けられる。
 *
 * 途中のページで取得に失敗したら例外にする。
 * 一部だけ拾って返すと、件数の急減ガードを潜り抜けた不完全なデータを書いてしまう。
 */
export async function fetchPlayerBlogPosts(): Promise<PlayerBlogEntry[]> {
  const posts: BlogPost[] = [];
  const seen = new Set<string>();
  let lastPage = 0;
  for (let page = 1; page <= PLAYER_BLOG_MAX_PAGES; page++) {
    const url = page === 1 ? `${SITE_URL}/player/blog/` : `${SITE_URL}/player/blog/page/${page}/`;
    const cards = parsePlayerBlogCards(await siteFetchText(url));
    // 記事が尽きたページは404ではなく空の一覧を返す。同じ記事が並ぶ場合も打ち切る。
    const fresh = cards.filter((post) => !seen.has(post.url));
    if (fresh.length === 0) break;
    for (const post of fresh) {
      seen.add(post.url);
      posts.push(post);
    }
    lastPage = page;
  }
  const entries = toPlayerBlogEntries(posts);
  logger.info(`選手ブログ: ${lastPage}ページから${posts.length}記事（背番号付き${entries.length}件）`);
  return entries;
}


function decodeEntities(s: string): string {
  return s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

/** 画像URLの実在確認。派生サイズの画像を採用してよいかの判定に使う。 */
export async function imageExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
      headers: WP_HEADERS,
    });
    return res.ok;
  } catch {
    return false;
  }
}
