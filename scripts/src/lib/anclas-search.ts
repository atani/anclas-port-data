/**
 * anclas.jp の公開検索経路（検索RSS・検索結果HTML）から投稿を取得する。
 *
 * WordPress REST API はデータセンター系IPからの `/wp-json/` へのアクセスを Apache が拒否し、
 * GitHub Actions 上では常に 403 になる。UA を変えても結果は変わらない。
 * 一方で `?s=<検索語>&feed=rss2` と検索結果HTMLは同じ環境から 200 で取得できるため、
 * REST API の `search` パラメータの代替としてこの2経路を使う。
 *
 * 検索RSSは REST API の `search` と同じ全文検索・同じ並び順で1ページ10件を返すため、
 * `getPosts({ search, perPage: 10 })` の置き換えになる。
 * アイキャッチ画像はRSSに含まれないため、ポスターだけは検索結果HTMLのカードから取得する。
 */

import { ANCLAS_FEED_HEADERS, decodeXml, element, postId } from "./news-feed.js";
import type { WPPost } from "./wordpress-client.js";

const SEARCH_URL = "https://anclas.jp/";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 記事一覧カードでアイキャッチ未設定の投稿に出るサイト既定画像。
 * この画像を試合ポスターとして採用しないために除外する。
 * 差し替えられた場合は誤った画像を出さず「ポスター未取得」の警告になる。
 */
const DEFAULT_CARD_IMAGE_BASENAME = "名称未設定のデザイン";

/**
 * RSSの pubDate（GMT）を REST API の `date` と同じ「オフセットを持たないJST」へ変換する。
 * 呼び出し側は `date.slice(0, 10)` の文字列比較や `new Date(date)` での日付判定をしており、
 * GMTのまま渡すと日付が1日ずれる。実行環境のタイムゾーンに依存させないため、
 * オフセット付きの表記ではなく REST API と同じ素の表記へ寄せる。
 */
export function toWordPressLocalDate(pubDate: string): string | null {
  const ms = Date.parse(pubDate);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 19);
}

/** content:encoded は CDATA 内の生HTML。REST API の content.rendered と同じ形で取り出す。 */
function contentHtml(block: string): string {
  const raw = block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)?.[1];
  if (raw == null) return "";
  return raw.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/)?.[1] ?? decodeXml(raw);
}

/**
 * 検索RSSを REST API と同じ WPPost の形へ変換する。
 * ニュース生成の `parseNewsFeedItems` はお知らせ以外と「試合」カテゴリを除外するため、
 * マッチレポート（「試合」カテゴリ付き）を落としてしまう。検索用は絞り込みをしない。
 */
export function parseSearchFeedPosts(xml: string): WPPost[] {
  const posts: WPPost[] = [];
  const seen = new Set<string>();
  for (const block of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const title = element(block, "title");
    const link = element(block, "link");
    const pubDate = element(block, "pubDate");
    if (!title || !link || !pubDate) continue;
    const date = toWordPressLocalDate(pubDate);
    if (!date) continue;
    // 投稿IDを取れない記事もあるため、重複判定はURLで行う。
    if (seen.has(link)) continue;
    seen.add(link);
    posts.push({
      id: postId(element(block, "guid") ?? "", link) ?? 0,
      date,
      title: { rendered: title },
      content: { rendered: contentHtml(block) },
      excerpt: { rendered: element(block, "description") ?? "" },
      link,
      categories: [],
      tags: [],
      featured_media: 0,
    });
  }
  return posts;
}

export interface SearchResultCard {
  url: string;
  title: string;
  /** カードに出る公開日（YYYY-MM-DD） */
  date: string;
  /** アイキャッチ画像。サイト既定画像だった場合は null */
  imageUrl: string | null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * 検索結果HTMLの記事カードから、投稿URL・タイトル・公開日・アイキャッチ画像を取り出す。
 * アイキャッチ画像はRSSに載らないため、ポスター取得だけはこの経路を使う。
 */
export function parseSearchResultCards(html: string): SearchResultCard[] {
  const cards: SearchResultCard[] = [];
  const blocks = html.split(/<a\b(?=[^>]*\bclass=["'][^"']*\bc-news-card\b)/i).slice(1);
  for (const block of blocks) {
    const url = block.match(/^[^>]*\bhref=["']([^"']+)["']/i)?.[1];
    const title = block.match(
      /<span[^>]*\bclass=["'][^"']*\bc-news-card__title-text\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    )?.[1];
    const date = block.match(
      /<time[^>]*\bclass=["'][^"']*\bc-news-card__date\b[^"']*["'][^>]*\bdatetime=["'](\d{4}-\d{2}-\d{2})["']/i,
    )?.[1];
    if (!url || !title || !date) continue;
    const image = block.match(/<img[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    const imageUrl = image && !image.includes(DEFAULT_CARD_IMAGE_BASENAME)
      ? decodeHtmlEntities(image)
      : null;
    cards.push({
      url: decodeHtmlEntities(url),
      title: decodeHtmlEntities(title.replace(/<[^>]+>/g, "")),
      date,
      imageUrl,
    });
  }
  return cards;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: ANCLAS_FEED_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`anclas.jp 検索の取得に失敗しました: ${response.status} ${response.statusText} ${url}`);
  }
  return response.text();
}

/** 同一実行内で同じ検索語を何度も引くため、取得結果を使い回す。 */
const feedCache = new Map<string, Promise<WPPost[]>>();
const cardCache = new Map<string, Promise<SearchResultCard[]>>();

/** 取得結果の使い回しを捨てる（テストで経路ごとの要求回数を確かめるために使う）。 */
export function resetAnclasSearchCache(): void {
  feedCache.clear();
  cardCache.clear();
}

function searchUrl(query: string, feed: boolean): string {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("s", query);
  if (feed) url.searchParams.set("feed", "rss2");
  return url.toString();
}

/** 検索RSSから投稿を取得する（REST APIの `getPosts({ search })` 相当、1ページ10件）。 */
export function fetchSearchFeedPosts(query: string): Promise<WPPost[]> {
  const cached = feedCache.get(query);
  if (cached) return cached;
  const pending = fetchText(searchUrl(query, true)).then(parseSearchFeedPosts);
  feedCache.set(query, pending);
  return pending;
}

/** 検索結果HTMLから記事カードを取得する。 */
export function fetchSearchResultCards(query: string): Promise<SearchResultCard[]> {
  const cached = cardCache.get(query);
  if (cached) return cached;
  const pending = fetchText(searchUrl(query, false)).then(parseSearchResultCards);
  cardCache.set(query, pending);
  return pending;
}
