import type { YouTubeVideo } from "./types.js";

const CHANNEL_ID = "UC1LJO-W5Q3q-HfcS4UM3GPQ";
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

interface FeedEntry {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
}

type Fetch = typeof fetch;
type VideoKind = "short" | "regular" | "unknown";

/** RSS の <entry> を順に取り出す（最新順） */
export function parseYouTubeFeed(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const blocks = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];
  for (const block of blocks) {
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = block.match(/<title>([^<]+)<\/title>/)?.[1];
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
    const thumb = block.match(/<media:thumbnail\s+url="([^"]+)"/)?.[1];
    if (!videoId || !title || !published) continue;
    entries.push({
      videoId,
      title,
      thumbnailUrl: thumb ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      publishedAt: published,
    });
  }
  return entries;
}

/**
 * 動画がショートか判定する。
 * /shorts/{ID} を HEAD で叩き、200 ならショート、303（/watch?v= にリダイレクト）なら通常動画。
 */
async function classifyVideo(videoId: string, fetchImpl: Fetch): Promise<VideoKind> {
  try {
    const res = await fetchImpl(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    if (res.status === 200) return "short";
    if (res.status === 303) return "regular";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function toVideo(e: FeedEntry, isShortValue: boolean): YouTubeVideo {
  return {
    videoId: e.videoId,
    title: e.title,
    thumbnailUrl: e.thumbnailUrl,
    url: isShortValue
      ? `https://www.youtube.com/shorts/${e.videoId}`
      : `https://www.youtube.com/watch?v=${e.videoId}`,
    publishedAt: e.publishedAt,
  };
}

/**
 * 最新の通常動画とショート動画をそれぞれ最大5件返す。
 * 単一件フィールドは既存クライアントとの後方互換用。
 */
export async function fetchLatestYouTubeVideos(fetchImpl: Fetch = fetch): Promise<{
  latest: YouTubeVideo | null;
  latestShort: YouTubeVideo | null;
  videos: YouTubeVideo[];
  shorts: YouTubeVideo[];
}> {
  try {
    const res = await fetchImpl(FEED_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    if (!res.ok) {
      return { latest: null, latestShort: null, videos: [], shorts: [] };
    }
    const entries = parseYouTubeFeed(await res.text()).slice(0, 15);

    const classifications: Array<{ entry: FeedEntry; kind: VideoKind }> = [];
    for (let index = 0; index < entries.length; index += 5) {
      classifications.push(
        ...(await Promise.all(
          entries.slice(index, index + 5).map(async (entry) => ({
            entry,
            kind: await classifyVideo(entry.videoId, fetchImpl),
          })),
        )),
      );
    }
    const videos: YouTubeVideo[] = [];
    const shorts: YouTubeVideo[] = [];
    for (const { entry, kind } of classifications) {
      if (kind === "short") {
        if (shorts.length < 5) shorts.push(toVideo(entry, true));
      } else if (kind === "regular") {
        if (videos.length < 5) videos.push(toVideo(entry, false));
      }
      if (videos.length === 5 && shorts.length === 5) break;
    }
    return {
      latest: videos[0] ?? null,
      latestShort: shorts[0] ?? null,
      videos,
      shorts,
    };
  } catch {
    return { latest: null, latestShort: null, videos: [], shorts: [] };
  }
}

/** 後方互換: 最新動画1件のみ（旧名関数） */
export async function fetchLatestYouTubeVideo(): Promise<YouTubeVideo | null> {
  const { latest, latestShort } = await fetchLatestYouTubeVideos();
  // 最新を優先（通常 or ショート、新しい方）
  if (latest && latestShort) {
    return latest.publishedAt > latestShort.publishedAt ? latest : latestShort;
  }
  return latest ?? latestShort;
}
