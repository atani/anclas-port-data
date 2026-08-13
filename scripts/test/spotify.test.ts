import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublishedDate } from "../src/lib/spotify.js";

test("parsePublishedDate: Spotify の UTC 公開時刻を JST の日付へ変換する", () => {
  const html = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"state":{"data":{"entity":{"releaseDate":{"isoString":"2026-08-12T23:40:00Z"}}}}}}}</script>`;

  assert.equal(parsePublishedDate(html), "2026-08-13");
});

test("parsePublishedDate: 公開日時が無い場合は null を返す", () => {
  assert.equal(parsePublishedDate('<script id="__NEXT_DATA__">{}</script>'), null);
});
