import type { WPMedia } from "./wordpress-client.js";

export const ANCLAS_MARK_URL =
  "https://anclas.jp/wp-content/themes/anclas/assets/images/logo.png";

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ? decodeHtmlAttribute(match[1]) : null;
}

/** 投稿本文にある最初の実画像URLを返す。data URIなどのプレースホルダーは除外する。 */
export function extractFirstContentImage(html: string): string | null {
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const candidate =
      attribute(tag, "data-src")
      ?? attribute(tag, "data-lazy-src")
      ?? attribute(tag, "src");
    if (!candidate || /^(?:data|blob):/i.test(candidate)) continue;
    try {
      const url = new URL(candidate, "https://anclas.jp/");
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      // 不正な画像URLは次のimgを探す
    }
  }
  return null;
}

/** アイキャッチ、本文画像、クラブマークの順にニュース画像を決定する。 */
export function selectNewsThumbnail(
  media: WPMedia | undefined,
  contentHtml: string,
): string {
  const sizes = media?.media_details?.sizes ?? {};
  return sizes["medium"]?.source_url
    ?? sizes["thumbnail"]?.source_url
    ?? media?.source_url
    ?? extractFirstContentImage(contentHtml)
    ?? ANCLAS_MARK_URL;
}
