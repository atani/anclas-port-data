import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpotifyEpisodes } from "../src/lib/spotify.js";
import {
  buildEventNotification,
  buildPodcastNotification,
  detectNewActiveEvents,
  EVENT_ANNOUNCEMENTS_TOPIC,
  detectNewPodcastEpisodes,
  NEW_PODCAST_TOPIC,
} from "../src/lib/remote-notification.js";
import type { PodcastEpisode } from "../src/lib/types.js";

function episode(id: string): PodcastEpisode {
  return {
    id,
    title: `Episode ${id}`,
    thumbnailUrl: "https://i.scdn.co/image/example",
    showUrl: `https://open.spotify.com/episode/${id}`,
    embedUrl: `https://open.spotify.com/embed/episode/${id}`,
    publishedAt: "2026-08-14",
  };
}

test("Spotify公開ページから安定ID付きエピソードを抽出する", () => {
  const parsed = parseSpotifyEpisodes(
    '<a href="/episode/new">New &amp; Episode</a><span>8月14日</span>',
    "https://example.com/cover.jpg",
    new Date("2026-08-14T00:00:00Z"),
  );
  assert.equal(parsed[0]?.id, "new");
  assert.equal(parsed[0]?.title, "New & Episode");
});

test("初回取得では既存エピソードを新着扱いしない", () => {
  assert.deepEqual(detectNewPodcastEpisodes([], [episode("new")]), []);
});

test("前回にない安定IDだけを新着として検出する", () => {
  const detected = detectNewPodcastEpisodes(
    [episode("old")],
    [episode("new"), episode("old")],
  );
  assert.deepEqual(detected.map((item) => item.id), ["new"]);
});

test("Podcast通知にtopic、ID、遷移URLを含める", () => {
  const notification = buildPodcastNotification(episode("new"));
  assert.equal(notification?.topic, NEW_PODCAST_TOPIC);
  assert.equal(notification?.data.contentId, "new");
  assert.equal(notification?.data.url, "https://open.spotify.com/episode/new");
});

const activeEvent = {
  id: "event-new",
  title: "アンクラスナイト",
  summary: "選手が来店します",
  actionUrl: "https://example.com/event",
  startsAt: "2026-08-30T14:00:00+09:00",
  endsAt: "2026-09-06T19:00:00+09:00",
};

test("新規かつ公開中のイベントだけを通知対象にする", () => {
  const detected = detectNewActiveEvents(
    [{ ...activeEvent, id: "event-old" }],
    [{ ...activeEvent, id: "event-old" }, activeEvent],
    new Date("2026-08-31T00:00:00+09:00"),
  );
  assert.deepEqual(detected.map((event) => event.id), ["event-new"]);
});

test("前回データを取得できない場合は一斉通知しない", () => {
  assert.deepEqual(
    detectNewActiveEvents(undefined, [activeEvent], new Date("2026-08-31T00:00:00+09:00")),
    [],
  );
});

test("イベント通知に専用topic、ID、遷移URLを含める", () => {
  const notification = buildEventNotification(activeEvent);
  assert.equal(notification.topic, EVENT_ANNOUNCEMENTS_TOPIC);
  assert.equal(notification.title, "アンクラスナイト");
  assert.equal(notification.body, "選手が来店します");
  assert.equal(notification.data.contentId, "event-new");
  assert.equal(notification.data.url, "https://example.com/event");
});
