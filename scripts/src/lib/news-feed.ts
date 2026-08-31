const FEED_URL = "https://anclas.jp/feed/";
const NEWS_CATEGORY_ARCHIVE_URLS = [
  "https://anclas.jp/news/category/notice/",
  "https://anclas.jp/news/category/news1/",
] as const;
const FEED_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline/1.0; +https://github.com/atani/anclas-port)",
};

export interface NewsFeedItem {
  id: number;
  title: string;
  url: string;
  publishedAt: string;
  categories: string[];
  contentHtml: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function element(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] == null ? null : decodeXml(match[1]);
}

function postId(guid: string, url: string): number | null {
  for (const candidate of [guid, url]) {
    try {
      const parsed = new URL(candidate);
      const queryId = Number(parsed.searchParams.get("p"));
      if (Number.isInteger(queryId) && queryId > 0) return queryId;
      const pathId = parsed.pathname.match(/\/post-(\d+)\/?$/)?.[1];
      if (pathId) return Number(pathId);
    } catch {
      // 次の候補を試す。
    }
  }
  return null;
}

/** RSSから、ALL NEWS・お知らせに属し試合ではない投稿を抽出する。 */
export function parseNewsFeedItems(xml: string): NewsFeedItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const items: NewsFeedItem[] = [];
  for (const block of blocks) {
    const categories = [...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
      .map((match) => decodeXml(match[1] ?? ""));
    if (
      !categories.includes("お知らせ")
      || !categories.includes("ALL NEWS")
      || categories.includes("試合")
    ) {
      continue;
    }

    const title = element(block, "title");
    const url = element(block, "link");
    const guid = element(block, "guid");
    const publishedAt = element(block, "pubDate");
    if (!title || !url || !guid || !publishedAt) continue;
    const id = postId(guid, url);
    if (id == null) continue;
    items.push({
      id,
      title,
      url,
      publishedAt,
      categories,
      contentHtml: element(block, "content:encoded") ?? element(block, "description") ?? "",
    });
  }
  return items;
}

/** 標準RSSから、通常ニュースとして扱う最新のお知らせを取得する。 */
export function parseLatestNewsFeedItem(xml: string): NewsFeedItem | null {
  return parseNewsFeedItems(xml)[0] ?? null;
}

async function fetchFeedXml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: FEED_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`RSSの取得に失敗しました: ${response.status} ${response.statusText} ${url}`);
  }
  return response.text();
}

export async function fetchLatestNewsFeedItem(): Promise<NewsFeedItem> {
  const item = parseLatestNewsFeedItem(await fetchFeedXml(FEED_URL));
  if (!item) {
    throw new Error("標準RSSに ALL NEWS・お知らせ 両方のカテゴリを持つ記事がありません");
  }
  return item;
}

/** REST APIが実行元を拒否した場合に、旧・新カテゴリRSSを統合して20件を復元する。 */
export async function fetchNewsCategoryFeedItems(limit: number): Promise<NewsFeedItem[]> {
  const byId = new Map<number, NewsFeedItem>();
  const errors: string[] = [];
  feedLoop:
  for (const baseUrl of NEWS_CATEGORY_ARCHIVE_URLS) {
    for (let page = 1; page <= 10; page += 1) {
      let xml: string;
      try {
        xml = await fetchFeedXml(`${baseUrl}?feed=rss2&paged=${page}`);
      } catch (error) {
        errors.push(String(error));
        break;
      }
      const blockCount = xml.match(/<item\b[\s\S]*?<\/item>/gi)?.length ?? 0;
      for (const item of parseNewsFeedItems(xml)) byId.set(item.id, item);
      if (byId.size >= limit) break feedLoop;
      if (blockCount < 10) break;
    }
  }
  const items = [...byId.values()]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
  if (items.length < limit) {
    const details = errors.length > 0 ? `: ${errors.join(" / ")}` : "";
    throw new Error(
      `カテゴリRSSのお知らせが不足しています（${items.length}件 / 必要${limit}件）${details}`,
    );
  }
  return items;
}
