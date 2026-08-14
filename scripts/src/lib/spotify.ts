import type { PodcastEpisode } from "./types.js";

const SHOW_URL = "https://open.spotify.com/show/3RnkWRyIMYe9IdtMmK7KFK";
const OEMBED_URL = `https://open.spotify.com/oembed?url=${encodeURIComponent(SHOW_URL)}`;
const EMBED_URL = "https://open.spotify.com/embed/show/3RnkWRyIMYe9IdtMmK7KFK";
const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)",
  "Accept-Language": "ja-JP,ja;q=0.9",
};

interface OEmbedResponse {
  title: string;
  thumbnail_url: string;
  iframe_url: string;
}

type Fetch = typeof fetch;

/** Spotify 埋め込みページの Next.js データから、公開日を JST で取り出す。 */
export function parsePublishedDate(html: string): string | null {
  const serializedState = html.match(
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!serializedState) return null;

  try {
    const data = JSON.parse(serializedState) as {
      props?: { pageProps?: { state?: { data?: { entity?: { releaseDate?: { isoString?: string } } } } } };
    };
    const isoString = data.props?.pageProps?.state?.data?.entity?.releaseDate?.isoString;
    if (!isoString || Number.isNaN(Date.parse(isoString))) return null;

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(isoString));
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return null;
  }
}

async function fetchPublishedDate(fetchImpl: Fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(EMBED_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    if (!res.ok) return null;
    return parsePublishedDate(await res.text());
  } catch {
    return null;
  }
}

async function fetchShowCard(fetchImpl: Fetch): Promise<PodcastEpisode | null> {
  try {
    const res = await fetchImpl(OEMBED_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: REQUEST_HEADERS,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OEmbedResponse;
    if (!data.title) return null;
    const publishedAt = await fetchPublishedDate(fetchImpl);
    return {
      id: null,
      title: data.title,
      thumbnailUrl: data.thumbnail_url,
      showUrl: SHOW_URL,
      embedUrl: data.iframe_url,
      publishedAt,
    };
  } catch {
    return null;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function episodeDate(segment: string, now: Date): string | null {
  const isoDate = segment.match(/20\d{2}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const japanese = segment.match(/(\d{1,2})月(\d{1,2})日/);
  if (japanese) {
    const month = Number(japanese[1]);
    const day = Number(japanese[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const currentMonth = now.getUTCMonth() + 1;
    const year = month > currentMonth + 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const englishWeekday = segment.match(
    /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i,
  )?.[1];
  const japaneseWeekday = segment.match(
    /(日曜日|月曜日|火曜日|水曜日|木曜日|金曜日|土曜日)/,
  )?.[1];
  if (!englishWeekday && !japaneseWeekday) return null;
  const targetDay = englishWeekday
    ? ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
        .indexOf(englishWeekday.toLowerCase())
    : ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"]
        .indexOf(japaneseWeekday!);
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - targetDay + 7) % 7));
  return date.toISOString().slice(0, 10);
}

export function parseSpotifyEpisodes(
  html: string,
  thumbnailUrl: string,
  now = new Date(),
): PodcastEpisode[] {
  const linkPattern = /href="\/episode\/([^"?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(linkPattern)];
  const seen = new Set<string>();
  const episodes: PodcastEpisode[] = [];
  for (let index = 0; index < matches.length && episodes.length < 5; index++) {
    const match = matches[index];
    if (!match) break;
    const id = match[1];
    const titleHtml = match[2];
    if (!id || !titleHtml) continue;
    const title = decodeHtml(titleHtml);
    if (!title) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const start = match.index ?? 0;
    const nextEpisode = matches
      .slice(index + 1)
      .find((candidate) => candidate[1] !== id);
    const end = nextEpisode?.index ?? html.length;
    const publishedAt = episodeDate(html.slice(start, end), now);
    episodes.push({
      id,
      title,
      thumbnailUrl,
      showUrl: `https://open.spotify.com/episode/${id}`,
      embedUrl: `https://open.spotify.com/embed/episode/${id}`,
      publishedAt,
    });
  }
  return episodes;
}

async function fetchEpisodeDate(
  episode: PodcastEpisode,
  fetchImpl: Fetch,
  now: Date,
): Promise<string | null> {
  try {
    const response = await fetchImpl(episode.showUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: REQUEST_HEADERS,
    });
    if (!response.ok) return null;
    return episodeDate(await response.text(), now);
  } catch {
    return null;
  }
}

export async function fetchLatestPodcasts(fetchImpl: Fetch = fetch): Promise<PodcastEpisode[]> {
  const showCardPromise = fetchShowCard(fetchImpl);
  try {
    const pageResponse = await fetchImpl(SHOW_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: REQUEST_HEADERS,
    });
    if (pageResponse.ok) {
      const showCard = await showCardPromise;
      const episodes = parseSpotifyEpisodes(
        await pageResponse.text(),
        showCard?.thumbnailUrl ?? "",
      );
      if (episodes.length > 0) {
        const now = new Date();
        return Promise.all(
          episodes.map(async (episode) => {
            if (episode.publishedAt != null) return episode;
            return {
              ...episode,
              publishedAt: await fetchEpisodeDate(episode, fetchImpl, now),
            };
          }),
        );
      }
    }
    const showCard = await showCardPromise;
    return showCard == null ? [] : [showCard];
  } catch {
    const showCard = await showCardPromise;
    return showCard == null ? [] : [showCard];
  }
}

/** 後方互換: 最新エピソード1件のみ。 */
export async function fetchLatestPodcast(): Promise<PodcastEpisode | null> {
  return (await fetchLatestPodcasts())[0] ?? null;
}
