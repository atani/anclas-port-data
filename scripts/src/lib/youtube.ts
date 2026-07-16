import type { YouTubeVideo } from "./types.js";

const CHANNEL_ID = "UC1LJO-W5Q3q-HfcS4UM3GPQ";
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

interface FeedEntry {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
}

/** RSS の <entry> を順に取り出す（最新順） */
function parseFeed(xml: string): FeedEntry[] {
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
async function isShort(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    return res.status === 200;
  } catch {
    return false;
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
 * 最新の通常動画とショート動画を1件ずつ返す（どちらも無ければ null）。
 * 上位8件まで判定してそれぞれ初出を採用する（API呼び出しを抑制）。
 */
export async function fetchLatestYouTubeVideos(): Promise<{ latest: YouTubeVideo | null; latestShort: YouTubeVideo | null }> {
  try {
    const res = await fetch(FEED_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    if (!res.ok) return { latest: null, latestShort: null };
    const entries = parseFeed(await res.text()).slice(0, 8);

    let latest: YouTubeVideo | null = null;
    let latestShort: YouTubeVideo | null = null;
    for (const e of entries) {
      if (latest && latestShort) break;
      const short = await isShort(e.videoId);
      if (short) {
        if (!latestShort) latestShort = toVideo(e, true);
      } else {
        if (!latest) latest = toVideo(e, false);
      }
    }
    return { latest, latestShort };
  } catch {
    return { latest: null, latestShort: null };
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
