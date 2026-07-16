import type { PodcastEpisode } from "./types.js";

const SHOW_URL = "https://open.spotify.com/show/3RnkWRyIMYe9IdtMmK7KFK";
const OEMBED_URL = `https://open.spotify.com/oembed?url=${encodeURIComponent(SHOW_URL)}`;
const EMBED_URL = "https://open.spotify.com/embed/show/3RnkWRyIMYe9IdtMmK7KFK";

interface OEmbedResponse {
  title: string;
  thumbnail_url: string;
  iframe_url: string;
}

async function fetchPublishedDate(): Promise<string | null> {
  try {
    const res = await fetch(EMBED_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/(202\d-\d{2}-\d{2})/);
    return match?.[1] ?? null;
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
