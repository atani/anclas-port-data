import type { Partner } from "./types.js";

/**
 * anclas.jp トップページの「オフィシャルパートナー」セクションから
 * パートナー各社のロゴ・リンクを抽出する。
 *
 * DOM 構造:
 *   <h3>…オフィシャルパートナー</h3>
 *   <div class="dp_sc_fl_box …">
 *     <div class="dp_sc_fl_item"><a href="…"><img … data-src="https://anclas.jp/wp-content/uploads/…" …></a></div>
 *     …（各社が同じ item ブロックで並ぶ）
 *   </div>
 *   </section> … <footer>
 *
 * ロゴ実体は lazyload のため <img src> は base64 プレースホルダで、実URLは data-src にある。
 * セクション終端の目印は見出しの後ろに現れる最初の <footer>（この見出しはページ末尾付近）。
 * なお「パートナー企業様募集」CTA は見出しより前に置かれているため終端には使わない。
 */

/** &amp; などの基本エンティティをデコード */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

/** タグ内の属性値を取り出す（属性順に依存しない） */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m && m[1] !== undefined ? m[1] : null;
}

/** ロゴのファイル名から表示名を補完する（サイズ違い接尾辞と WP のハッシュ接尾辞を除去） */
function nameFromLogo(logoUrl: string): string {
  const file = decodeURIComponent(logoUrl.split("/").pop() ?? logoUrl);
  return file
    .replace(/\.[a-z0-9]+$/i, "") // 拡張子
    .replace(/-\d+x\d+$/i, "") // -200x100 のサイズ違い
    .replace(/-[0-9a-f]{8,}$/i, "") // WP がリネーム時に付ける 8桁以上の16進サフィックス
    .trim();
}

/**
 * オフィシャルパートナー各社を抽出する。
 * 除外: href が anclas.jp 自身へのリンク（ロゴ・地図 embed 等のノイズ）／ロゴ画像が無いもの。
 * href が空のパートナー（サイト側でリンク未設定）はロゴを表示するため残し、url は空文字にする。
 */
export function parsePartners(html: string): Partner[] {
  const start = html.indexOf("オフィシャルパートナー");
  if (start < 0) return [];
  const footIdx = html.indexOf("<footer", start);
  const region = html.slice(start, footIdx >= 0 ? footIdx : undefined);

  const partners: Partner[] = [];
  const seen = new Set<string>();
  const pairRe = /<a\b[^>]*href="([^"]*)"[^>]*>\s*<img\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(region)) !== null) {
    const href = decodeEntities((m[1] ?? "").trim());
    if (/anclas\.jp/i.test(href)) continue; // 自サイトへのリンクはノイズ

    const imgTag = m[2] ?? "";
    const logoUrl = attr(imgTag, "data-src");
    if (!logoUrl || !/wp-content\/uploads\//.test(logoUrl)) continue;
    if (seen.has(logoUrl)) continue;
    seen.add(logoUrl);

    const alt = decodeEntities((attr(imgTag, "alt") ?? "").trim());
    partners.push({
      name: alt || nameFromLogo(logoUrl),
      url: href,
      logoUrl,
    });
  }
  return partners;
}
