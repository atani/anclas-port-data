import type { Player, PlayerPhoto, PlayerProfile } from "./types.js";
import type { WPMedia, WPPost } from "./wordpress-client.js";

/**
 * anclas.jp の TOP選手紹介投稿を Player に正規化する。
 *
 * タイトル: "#3澁澤光-shibusawa hikaru-"（背番号 + 漢字名 + ローマ字）
 * 本文 <p>: ラベル + 全角スペース + 値（生年月日/出身/身長/血液型/ニックネーム/経歴）
 *           値が <span data-sheets-root="1">…</span> で囲まれる場合がある
 * 本文 <table>: 2列（ラベル / 値）でパーソナル情報（サッカー歴・MBTI・趣味 等）
 * 顔写真: _embedded["wp:featuredmedia"] の media_details.sizes
 */

/** タグ除去 + エンティティデコード（<br> と </p> は改行に） */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;/g, "–")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** 先頭/末尾と内部の連続空白（全角含む）を整える。内部の単一スペースは保持 */
function cleanValue(s: string): string {
  return s.replace(/[\s　]+/gu, " ").trim();
}

interface ParsedTitle {
  number: number | null;
  nameJa: string;
  nameEn: string | null;
}

export function parsePlayerTitle(titleRaw: string): ParsedTitle {
  const title = htmlToText(titleRaw).trim();
  const numberMatch = title.match(/#\s*(\d+)/);
  const number = numberMatch && numberMatch[1] ? Number(numberMatch[1]) : null;

  // "#3" を除去 → "澁澤光-shibusawa hikaru-"
  const rest = title.replace(/^#\s*\d+\s*/, "").trim();
  // 末尾の "-ローマ字-" を取り出す（ローマ字は英字・空白・ドット）
  const romaMatch = rest.match(/-\s*([A-Za-z][A-Za-z\s.'-]*?)\s*-?\s*$/);
  const nameEn = romaMatch && romaMatch[1] ? cleanValue(romaMatch[1]).toUpperCase() : null;
  const nameJa = cleanValue(rest.replace(/-\s*[A-Za-z][A-Za-z\s.'-]*-?\s*$/, "")) || rest;

  return { number, nameJa, nameEn };
}

const PROFILE_LABELS: { label: string; key: keyof PlayerProfile }[] = [
  { label: "生年月日", key: "birthdate" },
  { label: "出身", key: "hometown" },
  { label: "身長", key: "height" },
  { label: "血液型", key: "bloodType" },
  { label: "経歴", key: "career" },
];

/** 本文 <p> 由来の基本プロフィールとニックネームを抽出 */
function parseProfileBlock(text: string): { profile: PlayerProfile; nickname: string | null } {
  const profile: PlayerProfile = {
    birthdate: null,
    hometown: null,
    height: null,
    bloodType: null,
    career: null,
  };
  let nickname: string | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (nickname === null && trimmed.startsWith("ニックネーム")) {
      nickname = cleanValue(trimmed.slice("ニックネーム".length));
      continue;
    }
    for (const { label, key } of PROFILE_LABELS) {
      if (profile[key] === null && trimmed.startsWith(label)) {
        const value = cleanValue(trimmed.slice(label.length));
        if (value) profile[key] = value;
        break;
      }
    }
  }
  return { profile, nickname };
}

/** 本文 <table> の2列をパーソナル情報配列に（表示順保持） */
function parsePersonalTable(html: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cell = cellRe.exec(row[1] ?? "")) !== null) {
      cells.push(cleanValue(htmlToText(cell[1] ?? "")));
    }
    if (cells.length >= 2 && cells[0] && cells[1]) {
      out.push({ label: cells[0], value: cells[1] });
    }
  }
  return out;
}

/** _embedded の featured media から各サイズのURLを取り出す */
function extractPhoto(media: WPMedia | undefined): PlayerPhoto {
  const sizes = media?.media_details?.sizes ?? {};
  const pick = (name: string): string | null => sizes[name]?.source_url ?? null;
  return {
    thumbnail: pick("thumbnail"),
    medium: pick("medium"),
    large: pick("large"),
    full: pick("full") ?? media?.source_url ?? null,
  };
}

export function parsePlayer(post: WPPost): Player {
  const { number, nameJa, nameEn } = parsePlayerTitle(post.title.rendered);
  const contentHtml = post.content.rendered;

  // <table> より前を <p> ブロック扱いにして基本プロフィールを取る
  const tableStart = contentHtml.search(/<table/i);
  const profileHtml = tableStart >= 0 ? contentHtml.slice(0, tableStart) : contentHtml;
  const { profile, nickname } = parseProfileBlock(htmlToText(profileHtml));
  const personal = parsePersonalTable(contentHtml);
  const photo = extractPhoto(post._embedded?.["wp:featuredmedia"]?.[0]);

  return {
    id: post.id,
    number,
    position: null,
    nameJa,
    nameEn,
    nickname,
    photo,
    profile,
    personal,
    sourceUrl: post.link,
    blogPosts: [],
    sns: {},
  };
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
