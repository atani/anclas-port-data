const FEED_URL = "https://anclas.jp/feed/";
const FEED_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline/1.0; +https://github.com/atani/anclas-port)",
};

export interface NewsFeedItem {
  id: number;
  title: string;
  url: string;
  publishedAt: string;
  categories: string[];
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

/** 標準RSSから、通常ニュースとして扱う最新のお知らせを取得する。 */
export function parseLatestNewsFeedItem(xml: string): NewsFeedItem | null {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
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
    return { id, title, url, publishedAt, categories };
  }
  return null;
}

export async function fetchLatestNewsFeedItem(): Promise<NewsFeedItem> {
  const response = await fetch(FEED_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: FEED_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`標準RSSの取得に失敗しました: ${response.status} ${response.statusText}`);
  }
  const item = parseLatestNewsFeedItem(await response.text());
  if (!item) {
    throw new Error("標準RSSに ALL NEWS・お知らせ 両方のカテゴリを持つ記事がありません");
  }
  return item;
}
