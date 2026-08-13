import type { PodcastEpisode } from "./types.js";

const SHOW_URL = "https://open.spotify.com/show/3RnkWRyIMYe9IdtMmK7KFK";
const OEMBED_URL = `https://open.spotify.com/oembed?url=${encodeURIComponent(SHOW_URL)}`;
const EMBED_URL = "https://open.spotify.com/embed/show/3RnkWRyIMYe9IdtMmK7KFK";

interface OEmbedResponse {
  title: string;
  thumbnail_url: string;
  iframe_url: string;
}

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

async function fetchPublishedDate(): Promise<string | null> {
  try {
    const res = await fetch(EMBED_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    if (!res.ok) return null;
    return parsePublishedDate(await res.text());
  } catch {
    return null;
  }
}

export async function fetchLatestPodcast(): Promise<PodcastEpisode | null> {
  const res = await fetch(OEMBED_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "anclas-port-pipeline (+https://github.com/atani/anclas-port-data)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as OEmbedResponse;
  if (!data.title) return null;
  const publishedAt = await fetchPublishedDate();
  return {
    title: data.title,
    thumbnailUrl: data.thumbnail_url,
    showUrl: SHOW_URL,
    embedUrl: data.iframe_url,
    publishedAt,
  };
}
