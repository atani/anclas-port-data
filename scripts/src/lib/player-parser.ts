import type { BlogPost, Player, PlayerPhoto, PlayerProfile } from "./types.js";

/**
 * anclas.jp の公開HTMLから選手データを取り出す。
 *
 * サイト改装で選手は投稿カテゴリ「TOP選手紹介」からカスタム投稿タイプ `player` へ移った。
 * REST API はデータセンター系IPから 403 になるため、公開ページだけを情報源にする。
 *
 * - 一覧 `/player/`: `c-season-switcher` にシーズン、`c-player-card` に各選手のURL
 * - 個別 `/player/<slug>/`: `c-player-info` に背番号・氏名・プロフィール・顔写真、
 *   `c-def-table` にパーソナル情報、`postid-<id>` または shortlink に投稿ID
 * - ブログ一覧 `/player/blog/`: `c-player-blog-card-wide` にタイトル・URL・公開日
 */

/** タグ除去 + エンティティデコード（<br> は改行に） */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, "–")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

/** 先頭/末尾と内部の連続空白（全角含む）を整える。内部の単一スペースは保持 */
function cleanValue(s: string): string {
  return s.replace(/[\s　]+/gu, " ").trim();
}

/** 指定クラスを持つ最初の要素の中身をテキストで返す。 */
function classText(html: string, className: string): string | null {
  const match = html.match(
    new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)</[^>]+>`, "i"),
  );
  const value = match?.[1] == null ? "" : cleanValue(htmlToText(match[1]));
  return value || null;
}

/**
 * 一覧ページのシーズン切替から現在のシーズンを取り出す。
 * 改装後はカテゴリ名（TOP選手紹介2026）が無くなり、ここだけが年度の情報源になる。
 */
export function parsePlayerSeason(html: string): string | null {
  const block = html.match(/<nav[^>]*\bc-season-switcher\b[\s\S]*?<\/nav>/i)?.[0];
  if (!block) return null;
  const current = block.match(
    /<a\b(?=[^>]*\bis-current\b)[^>]*>([\s\S]*?)<\/a>/i,
  )?.[1] ?? block.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  return cleanValue(htmlToText(current ?? "")).match(/\d{4}/)?.[0] ?? null;
}

/** 一覧ページのカードから選手個別ページのURLを掲載順に取り出す。 */
export function parsePlayerPageUrls(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(
    /<a\b(?=[^>]*\bclass=["'][^"']*\bc-player-card\b)[^>]*\bhref=["']([^"']+)["']/gi,
  )) {
    const url = new URL(match[1]!.replace(/&amp;/g, "&"), "https://anclas.jp/");
    url.hash = "";
    url.search = "";
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

const PROFILE_LABELS: { label: string; key: keyof PlayerProfile }[] = [
  { label: "生年月日", key: "birthdate" },
  { label: "出身", key: "hometown" },
  { label: "身長", key: "height" },
  { label: "血液型", key: "bloodType" },
  { label: "経歴", key: "career" },
];

/** `c-player-info__detail` のラベル・値ペアから基本プロフィールとニックネームを取り出す。 */
function parseProfileDetails(html: string): { profile: PlayerProfile; nickname: string | null } {
  const profile: PlayerProfile = {
    birthdate: null,
    hometown: null,
    height: null,
    bloodType: null,
    career: null,
  };
  let nickname: string | null = null;

  for (const item of html.matchAll(
    /<li\b(?=[^>]*\bc-player-info__detail\b)[\s\S]*?<\/li>/gi,
  )) {
    const label = classText(item[0], "c-player-info__detail-label");
    const value = classText(item[0], "c-player-info__detail-value");
    if (!label || !value) continue;
    if (nickname === null && label === "ニックネーム") {
      nickname = value;
      continue;
    }
    const known = PROFILE_LABELS.find((entry) => entry.label === label);
    if (known && profile[known.key] === null) profile[known.key] = value;
  }
  return { profile, nickname };
}

/** `c-def-table` の行（th=ラベル / td=値）をパーソナル情報配列に（表示順保持） */
function parsePersonalTable(html: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const row of html.matchAll(/<tr\b(?=[^>]*\bc-def-table__row\b)[\s\S]*?<\/tr>/gi)) {
    const label = classText(row[0], "c-def-table__cell--label");
    const value = classText(row[0], "c-def-table__cell--value");
    if (label && value) out.push({ label, value });
  }
  return out;
}

/**
 * 顔写真は公開ページに原寸が1枚しか出ないため、ここでは4サイズに同じURLを入れる。
 * 縮小版の復元は `photo-sizes.ts` が実在確認つきで行う（理由もそちらに書く）。
 */
function extractPhoto(html: string): PlayerPhoto {
  // 顔写真以外の画像（ロゴ・関連選手カード）を拾わないよう、対象の picture 内に限定する。
  const block = html.match(/<picture\b[^>]*\bc-player-info__photo\b[\s\S]*?<\/picture>/i)?.[0];
  const src = block?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  const url = src ? htmlToText(src) : null;
  return { thumbnail: url, medium: url, large: url, full: url };
}

/** 個別ページの投稿IDを shortlink か body クラスから取り出す。 */
function extractPostId(html: string): number | null {
  const shortlink = html.match(/rel=["']shortlink["']\s+href=["'][^"']*[?&]p=(\d+)/i)?.[1]
    ?? html.match(/\bpostid-(\d+)\b/)?.[1];
  return shortlink ? Number(shortlink) : null;
}

/** 選手個別ページを Player に正規化する。 */
export function parsePlayerPage(html: string, sourceUrl: string): Player {
  const id = extractPostId(html);
  if (id === null) {
    throw new Error(`選手ページから投稿IDを取得できませんでした: ${sourceUrl}`);
  }
  // 関連選手スライダーの `c-player-card` を巻き込まないよう、選手情報ブロックだけを見る。
  const infoStart = html.search(/<div\b[^>]*\bc-player-info\b/i);
  const info = infoStart < 0 ? html : html.slice(infoStart).split(/<div\b[^>]*\bc-player-faq\b/i)[0]!;
  const nameJa = classText(info, "c-player-info__name");
  if (!nameJa) {
    throw new Error(`選手ページから氏名を取得できませんでした: ${sourceUrl}`);
  }
  const numberText = classText(info, "c-player-info__number");
  const nameEn = classText(info, "c-player-info__furigana");
  const { profile, nickname } = parseProfileDetails(info);

  return {
    id,
    number: numberText && /^\d+$/.test(numberText) ? Number(numberText) : null,
    position: null,
    nameJa,
    nameEn: nameEn ? nameEn.toUpperCase() : null,
    nickname,
    photo: extractPhoto(info),
    profile,
    personal: parsePersonalTable(html),
    sourceUrl,
    blogPosts: [],
    sns: {},
    role: null,
  };
}

export interface PlayerBlogEntry {
  number: number;
  name: string | null;
  post: BlogPost;
}

/**
 * ブログ記事タイトルの「#背番号 選手名」から紐付けキーを取り出す。
 * 背番号が変わっても照合できるよう、番号だけでなく名前も拾う。
 */
const BLOG_TITLE_KEY =
  /#(\d+)\s*([　-鿿豈-﫿\u{20000}-\u{2FA1F}A-Za-zぁ-ん゠-ヿ]+(?:\s[　-鿿豈-﫿\u{20000}-\u{2FA1F}A-Za-zぁ-ん゠-ヿ]+)*)?/u;

/** ブログ一覧ページのカードを掲載順に取り出す（選手名が付かない記事も含む）。 */
export function parsePlayerBlogCards(html: string): BlogPost[] {
  const posts: BlogPost[] = [];
  const blocks = html.split(/<a\b(?=[^>]*\bclass=["'][^"']*\bc-player-blog-card-wide\b)/i).slice(1);
  for (const block of blocks) {
    const url = block.match(/^[^>]*\bhref=["']([^"']+)["']/i)?.[1];
    const title = classText(block, "c-player-blog-card-wide__title-text");
    const date = block.match(
      /<time[^>]*\bc-player-blog-card-wide__date\b[^>]*\bdatetime=["'](\d{4}-\d{2}-\d{2})["']/i,
    )?.[1];
    if (!url || !title || !date) continue;
    posts.push({ title, url: htmlToText(url), date });
  }
  return posts;
}

/**
 * タイトルに「#背番号 選手名」を持つ記事だけを紐付けキー付きで返す。
 * 選手名の入らない記事（お知らせ等）は紐付けようがないため落とす。
 */
export function toPlayerBlogEntries(posts: BlogPost[]): PlayerBlogEntry[] {
  const entries: PlayerBlogEntry[] = [];
  for (const post of posts) {
    const key = post.title.match(BLOG_TITLE_KEY);
    if (!key) continue;
    entries.push({
      number: Number(key[1]),
      name: key[2]?.replace(/\s+/g, "") ?? null,
      post,
    });
  }
  return entries;
}

/** 背番号順に整列（背番号 null は末尾） */
export function sortPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    if (a.number === null && b.number === null) return a.id - b.id;
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  });
}

/**
 * 公式ページに現れない途中加入選手を補完する。
 * 同名の公式データが取得できた場合は公式データを優先し、
 * 背番号が再利用された場合は補完対象を現在の選手として扱う。
 */
export function mergeSupplementalPlayers(players: Player[], supplemental: Player[]): Player[] {
  const normalizeName = (name: string): string => name.replace(/[\s　]/g, "");
  const supplementalByName = new Map(
    supplemental.map((player) => [normalizeName(player.nameJa), player]),
  );
  const supplementalNames = new Set(supplemental.map((player) => normalizeName(player.nameJa)));
  const officialNames = new Set(players.map((player) => normalizeName(player.nameJa)));
  const enriched = players.map((player) => {
    const fallback = supplementalByName.get(normalizeName(player.nameJa));
    if (!fallback) return player;
    return {
      ...player,
      number: player.number ?? fallback.number,
      position: player.position ?? fallback.position,
      nameEn: player.nameEn ?? fallback.nameEn,
      nickname: player.nickname ?? fallback.nickname,
      photo: {
        thumbnail: player.photo.thumbnail ?? fallback.photo.thumbnail,
        medium: player.photo.medium ?? fallback.photo.medium,
        large: player.photo.large ?? fallback.photo.large,
        full: player.photo.full ?? fallback.photo.full,
      },
      profile: {
        birthdate: player.profile.birthdate ?? fallback.profile.birthdate,
        hometown: player.profile.hometown ?? fallback.profile.hometown,
        height: player.profile.height ?? fallback.profile.height,
        bloodType: player.profile.bloodType ?? fallback.profile.bloodType,
        career: player.profile.career ?? fallback.profile.career,
      },
      personal: player.personal.length > 0 ? player.personal : fallback.personal,
    };
  });
  const additions = supplemental.filter(
    (player) => !officialNames.has(normalizeName(player.nameJa)),
  );
  const replacedNumbers = new Set(
    additions.flatMap((player) => (player.number === null ? [] : [player.number])),
  );
  const kept = enriched.filter(
    (player) =>
      supplementalNames.has(normalizeName(player.nameJa))
      || player.number === null
      || !replacedNumbers.has(player.number),
  );
  return sortPlayers([...kept, ...additions]);
}
