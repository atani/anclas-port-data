import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePhotoSizeUrl, resolvePhotoSizes } from "../src/lib/photo-sizes.js";
import type { PlayerPhoto } from "../src/lib/types.js";

const FULL = "https://anclas.jp/wp-content/uploads/2026/07/moriwa-940x940-1.jpg";

function photoOf(url: string | null): PlayerPhoto {
  return { thumbnail: url, medium: url, large: url, full: url };
}

test("拡張子の直前にサイズを挟んだURLを組み立てる", () => {
  assert.equal(
    derivePhotoSizeUrl(FULL, "150x150"),
    "https://anclas.jp/wp-content/uploads/2026/07/moriwa-940x940-1-150x150.jpg",
  );
  assert.equal(derivePhotoSizeUrl("https://anclas.jp/a/b.PNG", "300x300"), "https://anclas.jp/a/b-300x300.PNG");
});

test("拡張子が画像でなければ組み立てない", () => {
  assert.equal(derivePhotoSizeUrl("https://anclas.jp/player/moriwa/", "150x150"), null);
});

test("実在する派生画像だけを採用する", async () => {
  const asked: string[] = [];
  const resolved = await resolvePhotoSizes(photoOf(FULL), async (url) => {
    asked.push(url);
    return url.includes("-150x150");
  });
  assert.equal(resolved.thumbnail, "https://anclas.jp/wp-content/uploads/2026/07/moriwa-940x940-1-150x150.jpg");
  // 300x300 は実在しないので原寸のまま
  assert.equal(resolved.medium, FULL);
  assert.equal(resolved.large, FULL);
  assert.equal(resolved.full, FULL);
  assert.equal(asked.length, 2);
});

test("派生画像が1つも無ければ原寸のまま返す", async () => {
  const resolved = await resolvePhotoSizes(photoOf(FULL), async () => false);
  assert.deepEqual(resolved, photoOf(FULL));
});

test("顔写真が無ければ実在確認をしない", async () => {
  let called = 0;
  const resolved = await resolvePhotoSizes(photoOf(null), async () => {
    called += 1;
    return true;
  });
  assert.deepEqual(resolved, photoOf(null));
  assert.equal(called, 0);
});
