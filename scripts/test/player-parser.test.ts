import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePlayer, parsePlayerTitle, sortPlayers } from "../src/lib/player-parser.js";
import type { Player } from "../src/lib/types.js";
import type { WPPost } from "../src/lib/wordpress-client.js";

const posts = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/player-shibusawa.json", import.meta.url)), "utf-8"),
) as WPPost[];

test("parsePlayerTitle: 背番号・漢字名・ローマ字（大文字化）", () => {
  assert.deepEqual(parsePlayerTitle("#3澁澤光-shibusawa hikaru-"), {
    number: 3,
    nameJa: "澁澤光",
    nameEn: "SHIBUSAWA HIKARU",
  });
});

test("parsePlayerTitle: 複合名（クレア姫麗）", () => {
  const r = parsePlayerTitle("#11嘉数クレア姫麗-kakazu claire kirara-");
  assert.equal(r.number, 11);
  assert.equal(r.nameJa, "嘉数クレア姫麗");
  assert.equal(r.nameEn, "KAKAZU CLAIRE KIRARA");
});

test("parsePlayer: 実fixtureで全ブロックを抽出", () => {
  const p = parsePlayer(posts[0]!);
  assert.equal(p.number, 3);
  assert.equal(p.nameJa, "澁澤光");
  assert.equal(p.nameEn, "SHIBUSAWA HIKARU");
  assert.equal(p.nickname, "ひか");

  assert.equal(p.profile.birthdate, "2000年3月3日");
  assert.equal(p.profile.hometown, "埼玉県");
  assert.equal(p.profile.height, "168cm");
  assert.equal(p.profile.bloodType, "O型");
  assert.ok(p.profile.career?.includes("常盤木学園"));

  // 写真サイズ
  assert.ok(p.photo.thumbnail?.startsWith("https://"));
  assert.ok(p.photo.full?.startsWith("https://"));

  // パーソナル（table）
  const mbti = p.personal.find((x) => x.label === "MBTI");
  assert.equal(mbti?.value, "INFJ 提唱者");
  assert.ok(p.personal.length >= 10);
});

test("sortPlayers: 背番号昇順、null は末尾", () => {
  const mk = (n: number | null, id: number): Player => ({
    id,
    number: n,
    position: null,
    nameJa: "x",
    nameEn: null,
    nickname: null,
    photo: { thumbnail: null, medium: null, large: null, full: null },
    profile: { birthdate: null, hometown: null, height: null, bloodType: null, career: null },
    personal: [],
    sourceUrl: "",
    blogPosts: [],
    sns: {},
  });
  const sorted = sortPlayers([mk(10, 1), mk(null, 2), mk(3, 3)]);
  assert.deepEqual(
    sorted.map((p) => p.number),
    [3, 10, null],
  );
});
