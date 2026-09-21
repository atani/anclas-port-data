import type { Partner } from "./types.js";

/**
 * anclas.jp トップページの SPONSOR セクションから、
 * スポンサー各社のロゴ・リンクをグループ名付きで抽出する。
 *
 * DOM 構造（2026-09 のリニューアル後）:
 *   <div class="c-sponsor__group">
 *     <h3 class="c-sponsor__group-label"><span>オフィシャルパートナー</span></h3>
 *     <ul class="c-sponsor__list">
 *       <li class="c-sponsor__item fade">
 *         <a class="c-sponsor-card" href="…" target="_blank" rel="noopener">
 *           <img class="u-image-contain" src="https://anclas.jp/wp-content/uploads/…" alt="株式会社トレス" …>
 *         </a>
 *       </li>
 *       …（各社が同じ item で並ぶ）
 *     </ul>
 *   </div>
 *
 * 旧構造（`dp_sc_fl_item` と lazyload の data-src）からの変更点は 3 つある。
 *   1. ロゴの実URLが src に入る（プレースホルダの data-src は無くなった）
 *   2. alt に正式社名が入る（以前は空が多く、ファイル名から補完していた）
 *   3. グループが見出し付きで分かれ、「雇用サポート企業」が併記される
 *
 * 見出しで範囲を区切らずに全ロゴを拾うと、どの会社がどのグループか分からなくなる。
 * アプリは group ごとに見出しを付けて出すため、グループ単位で切り出す。
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
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
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

/** 旧構造で抽出したときに付けるグループ名。 */
const LEGACY_GROUP = "オフィシャルパートナー";

/**
 * SPONSOR セクションのグループを、サイトに並ぶ順で切り出す。
 *
 * 新構造は見出しと `<ul>` が対になっている。旧構造には対応が無いため、
 * 「オフィシャルパートナー」の見出しから `<footer>` までを 1 グループとして扱う。
 * `scoped` は新構造で切り出せたかを表し、ノイズの落とし方の判断に使う。
 */
function sponsorGroups(
  html: string,
): { label: string; region: string; scoped: boolean }[] {
  const groupRe =
    /<h3[^>]*class="[^"]*c-sponsor__group-label[^"]*"[^>]*>([\s\S]*?)<\/h3>\s*<ul[^>]*class="[^"]*c-sponsor__list[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
  const groups: { label: string; region: string; scoped: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(html)) !== null) {
    const label = decodeEntities((m[1] ?? "").replace(/<[^>]*>/g, "")).trim();
    if (label) groups.push({ label, region: m[2] ?? "", scoped: true });
  }
  if (groups.length > 0) return groups;

  const start = html.indexOf(LEGACY_GROUP);
  if (start < 0) return [];
  const footIdx = html.indexOf("<footer", start);
  return [
    {
      label: LEGACY_GROUP,
      region: html.slice(start, footIdx >= 0 ? footIdx : undefined),
      scoped: false,
    },
  ];
}

/**
 * SPONSOR セクションの各社を、グループ名付きで並び順どおりに抽出する。
 *
 * グループは「オフィシャルパートナー」と「雇用サポート企業」の 2 つ。
 * 両方に載る会社（スーパーレンタカー）はサイトと同じく両方へ出したいので、
 * 重複除去はグループの中だけで行う。
 *
 * 外部サイトを持たないパートナーは、サイト側で href が空か anclas.jp 内の
 * パートナー紹介ページへ向く。どちらもロゴは出したいので候補には残し、
 * url を空文字にしてアプリ側がリンクを張らないようにする。
 *
 * 除外するのはロゴ画像が無いものだけ。ただし旧構造では見出しから `<footer>` までを
 * 範囲にしており、地図 embed などのノイズが同じ範囲に入る。そちらでは従来どおり
 * anclas.jp へのリンクを落とす。
 */
export function parsePartners(html: string): Partner[] {
  const partners: Partner[] = [];
  for (const { label, region, scoped } of sponsorGroups(html)) {
    const seen = new Set<string>();
    const pairRe = /<a\b[^>]*href="([^"]*)"[^>]*>\s*<img\b([^>]*?)>/gi;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(region)) !== null) {
      const raw = decodeEntities((m[1] ?? "").trim());
      const isSelf = /anclas\.jp/i.test(raw);
      if (isSelf && !scoped) continue; // 旧構造では自サイトへのリンクはノイズ
      const href = isSelf ? "" : raw;

      const imgTag = m[2] ?? "";
      // 新構造は src が実URL。旧構造の data-src も読み、どちらでも通るようにする。
      const logoUrl = attr(imgTag, "data-src") ?? attr(imgTag, "src");
      if (!logoUrl || !/wp-content\/uploads\//.test(logoUrl)) continue;
      if (seen.has(logoUrl)) continue;
      seen.add(logoUrl);

      const alt = decodeEntities((attr(imgTag, "alt") ?? "").trim());
      partners.push({
        name: alt || nameFromLogo(logoUrl),
        url: href,
        logoUrl,
        group: label,
      });
    }
  }
  return partners;
}
