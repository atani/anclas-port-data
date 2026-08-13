import type { PodcastEpisode } from "./types.js";

export const MATCH_RESULTS_TOPIC = "match-results";
export const NEW_PODCAST_TOPIC = "new-podcast";

export interface RemoteNotification {
  topic: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export function podcastEpisodeId(episode: PodcastEpisode): string | null {
  if (episode.id) return episode.id;
  for (const rawUrl of [episode.showUrl, episode.embedUrl]) {
    try {
      const segments = new URL(rawUrl).pathname.split("/");
      const episodeIndex = segments.indexOf("episode");
      const id = segments[episodeIndex + 1];
      if (episodeIndex >= 0 && id) return id;
    } catch {
      // Malformed legacy URLs cannot be used as stable identifiers.
    }
  }
  return null;
}

export function detectNewPodcastEpisodes(
  previous: PodcastEpisode[] | undefined,
  current: PodcastEpisode[],
): PodcastEpisode[] {
  const previousIds = new Set(
    (previous ?? []).map(podcastEpisodeId).filter((id): id is string => id !== null),
  );
  if (previousIds.size === 0) return [];
  return current.filter((episode) => {
    const id = podcastEpisodeId(episode);
    return id !== null && !previousIds.has(id);
  });
}

export function buildPodcastNotification(
  episode: PodcastEpisode,
): RemoteNotification | null {
  const id = podcastEpisodeId(episode);
  if (!id) return null;
  return {
    topic: NEW_PODCAST_TOPIC,
    title: "新しいエピソードが公開されました",
    body: episode.title,
    data: {
      type: "podcast",
      contentId: id,
      url: episode.showUrl,
    },
  };
}
