import type { PodcastEpisode } from "./types.js";

export const MATCH_RESULTS_TOPIC = "match-results";
export const NEW_PODCAST_TOPIC = "new-podcast";
export const EVENT_ANNOUNCEMENTS_TOPIC = "event-announcements";

export interface RemoteNotification {
  topic: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface EventAnnouncement {
  id: string;
  title: string;
  summary?: string;
  periodLabel?: string;
  actionUrl: string;
  startsAt: string;
  endsAt: string;
}

export function detectNewActiveEvents(
  previous: EventAnnouncement[] | undefined,
  current: EventAnnouncement[],
  now = new Date(),
): EventAnnouncement[] {
  if (previous === undefined) return [];
  const previousIds = new Set(previous.map((event) => event.id));
  const nowMs = now.getTime();
  return current.filter((event) => {
    const startsAt = Date.parse(event.startsAt);
    const endsAt = Date.parse(event.endsAt);
    return (
      !previousIds.has(event.id) &&
      Number.isFinite(startsAt) &&
      Number.isFinite(endsAt) &&
      startsAt <= nowMs &&
      nowMs < endsAt
    );
  });
}

export function buildEventNotification(
  event: EventAnnouncement,
): RemoteNotification {
  return {
    topic: EVENT_ANNOUNCEMENTS_TOPIC,
    title: event.title,
    body: event.summary ?? event.periodLabel ?? "新しいイベントのお知らせがあります",
    data: {
      type: "event",
      contentId: event.id,
      url: event.actionUrl,
    },
  };
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
