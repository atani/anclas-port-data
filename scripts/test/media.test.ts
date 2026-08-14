import assert from "node:assert/strict";
import test from "node:test";

import { fetchLatestPodcasts, parseSpotifyEpisodes } from "../src/lib/spotify.js";
import { fetchLatestYouTubeVideos, parseYouTubeFeed } from "../src/lib/youtube.js";
import { mergeMedia } from "../src/lib/media-merge.js";

test("Spotify公開ページから新しい順に5エピソードを抽出する", () => {
  const html = [
    '<a href="/episode/episode-18">Episode &amp; 18</a><span>7月31日</span>',
    '<a href="/episode/episode-17">Episode 17</a><span>7月22日</span>',
    '<a href="/episode/episode-16">Episode 16</a><span>7月19日</span>',
    '<a href="/episode/episode-15">Episode 15</a><span>7月9日</span>',
    '<a href="/episode/episode-14">Episode 14</a><span>7月4日</span>',
    '<a href="/episode/episode-13">Episode 13</a><span>6月25日</span>',
  ].join("");

  const episodes = parseSpotifyEpisodes(
    html,
    "https://example.com/cover.jpg",
    new Date("2026-08-12T00:00:00Z"),
  );

  assert.equal(episodes.length, 5);
  assert.deepEqual(episodes[0], {
    id: "episode-18",
    title: "Episode & 18",
    thumbnailUrl: "https://example.com/cover.jpg",
    showUrl: "https://open.spotify.com/episode/episode-18",
    embedUrl: "https://open.spotify.com/embed/episode/episode-18",
    publishedAt: "2026-07-31",
  });
  assert.equal(episodes.at(4)?.title, "Episode 14");
});

test("Spotifyの曜日表記を直近の公開日に変換する", () => {
  const episodes = parseSpotifyEpisodes(
    '<a href="/episode/episode-19">Episode 19</a><span>Wednesday</span>',
    "",
    new Date("2026-08-14T00:00:00Z"),
  );

  assert.equal(episodes[0]?.publishedAt, "2026-08-12");
});

test("Spotifyの日本語曜日表記を直近の公開日に変換する", () => {
  const episodes = parseSpotifyEpisodes(
    '<a href="/episode/episode-19">Episode 19</a><span>水曜日</span>',
    "",
    new Date("2026-08-14T00:00:00Z"),
  );

  assert.equal(episodes[0]?.publishedAt, "2026-08-12");
});

test("Spotifyの空リンクより後にある同一エピソードのタイトルを採用する", () => {
  const episodes = parseSpotifyEpisodes(
    '<a href="/episode/episode-19"><img /></a>' +
      '<a href="/episode/episode-19">Episode 19</a>' +
      '<a href="/episode/episode-19"><span>再生</span></a>' +
      '<span>Wednesday</span>' +
      '<a href="/episode/episode-18">Episode 18</a>',
    "",
    new Date("2026-08-14T00:00:00Z"),
  );

  assert.equal(episodes[0]?.title, "Episode 19");
  assert.equal(episodes[0]?.publishedAt, "2026-08-12");
});

test("YouTube RSSから動画を新しい順に抽出する", () => {
  const xml = `
    <entry>
      <yt:videoId>video-a</yt:videoId>
      <title>Video A</title>
      <published>2026-08-01T00:00:00+00:00</published>
      <media:thumbnail url="https://example.com/a.jpg" />
    </entry>
    <entry>
      <yt:videoId>video-b</yt:videoId>
      <title>Video B</title>
      <published>2026-07-01T00:00:00+00:00</published>
    </entry>`;

  const videos = parseYouTubeFeed(xml);

  assert.equal(videos.length, 2);
  assert.equal(videos.at(0)?.videoId, "video-a");
  assert.equal(videos.at(1)?.thumbnailUrl, "https://i.ytimg.com/vi/video-b/hqdefault.jpg");
});

test("oEmbedが失敗してもSpotify公開ページのエピソードを返す", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = input.toString();
    if (url.includes("/oembed")) throw new Error("oEmbed unavailable");
    if (url.includes("/show/")) {
      return new Response('<a href="/episode/episode-1">Episode 1</a><span>8月1日</span>');
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const episodes = await fetchLatestPodcasts(fetchMock);

  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]?.id, "episode-1");
  assert.equal(episodes[0]?.thumbnailUrl, "");
});

test("一覧に日付がなければSpotifyエピソードページから補完する", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = input.toString();
    if (url.includes("/oembed")) return new Response(null, { status: 500 });
    if (url.endsWith("/show/3RnkWRyIMYe9IdtMmK7KFK")) {
      return new Response('<a href="/episode/episode-19">Episode 19</a>');
    }
    if (url.endsWith("/episode/episode-19")) {
      return new Response("<span>2026-08-12</span>");
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const episodes = await fetchLatestPodcasts(fetchMock);

  assert.equal(episodes[0]?.publishedAt, "2026-08-12");
});

test("YouTube種別判定の一時失敗は通常動画へ混ぜない", async () => {
  const feed = `
    <entry><yt:videoId>short</yt:videoId><title>Short</title><published>2026-08-03T00:00:00Z</published></entry>
    <entry><yt:videoId>unknown</yt:videoId><title>Unknown</title><published>2026-08-02T00:00:00Z</published></entry>
    <entry><yt:videoId>regular</yt:videoId><title>Regular</title><published>2026-08-01T00:00:00Z</published></entry>`;
  const fetchMock: typeof fetch = async (input) => {
    const url = input.toString();
    if (url.includes("/feeds/")) return new Response(feed);
    if (url.endsWith("/short")) return new Response(null, { status: 200 });
    if (url.endsWith("/regular")) return new Response(null, { status: 303 });
    return new Response(null, { status: 429 });
  };

  const result = await fetchLatestYouTubeVideos(fetchMock);

  assert.deepEqual(result.shorts.map((video) => video.videoId), ["short"]);
  assert.deepEqual(result.videos.map((video) => video.videoId), ["regular"]);
});

test("部分取得は前回値で重複なく最大5件まで補完する", () => {
  const current = [{ id: "new" }, { id: "same" }];
  const previous = [
    { id: "same" },
    { id: "old-1" },
    { id: "old-2" },
    { id: "old-3" },
    { id: "old-4" },
  ];

  assert.deepEqual(
    mergeMedia(current, previous, (item) => item.id),
    [
      { id: "new" },
      { id: "same" },
      { id: "old-1" },
      { id: "old-2" },
      { id: "old-3" },
    ],
  );
});

test("YouTube種別判定は同時に最大5件まで実行する", async () => {
  const feed = Array.from(
    { length: 12 },
    (_, index) =>
      `<entry><yt:videoId>video-${index}</yt:videoId><title>Video ${index}</title><published>2026-08-01T00:00:00Z</published></entry>`,
  ).join("");
  let active = 0;
  let maximumActive = 0;
  const fetchMock: typeof fetch = async (input) => {
    const url = input.toString();
    if (url.includes("/feeds/")) return new Response(feed);
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return new Response(null, { status: 303 });
  };

  await fetchLatestYouTubeVideos(fetchMock);

  assert.equal(maximumActive, 5);
});
