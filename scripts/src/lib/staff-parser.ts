import type { Staff } from "./types.js";

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/[\s　]+/gu, " ").trim();
}

function classContent(block: string, className: string): string | null {
  const match = block.match(
    new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
  );
  const value = match?.[1] == null ? "" : text(match[1]);
  return value || null;
}

function imageUrl(block: string): string | null {
  const tag = block.match(/<img\b(?=[^>]*\bc-staff-card__image\b)[^>]*>/i)?.[0];
  if (!tag) return null;
  const value = tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1];
  if (!value) return null;
  try {
    return new URL(decodeEntities(value), "https://anclas.jp/").toString();
  } catch {
    return null;
  }
}

/** 公式 /staff のカードを掲載順のまま抽出する。 */
export function parseStaff(html: string): Staff[] {
  const staff: Staff[] = [];
  const seen = new Set<string>();
  const blocks = html.match(/<li\b(?=[^>]*\bc-staff-list__item\b)[\s\S]*?<\/li>/gi) ?? [];
  for (const block of blocks) {
    const name = classContent(block, "c-staff-card__name");
    const role = classContent(block, "c-staff-card__role");
    if (!name || !role || seen.has(name)) continue;
    seen.add(name);
    staff.push({ name, role, photoUrl: imageUrl(block) });
  }
  return staff;
}
