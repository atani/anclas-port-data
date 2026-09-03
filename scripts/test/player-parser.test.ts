import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  mergeSupplementalPlayers,
  parsePlayer,
  parsePlayerTitle,
  reconcilePublishedPlayers,
  sortPlayers,
} from "../src/lib/player-parser.js";
import type { Player, PlayersData } from "../src/lib/types.js";
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
    role: null,
  });
  const sorted = sortPlayers([mk(10, 1), mk(null, 2), mk(3, 3)]);
  assert.deepEqual(
    sorted.map((p) => p.number),
    [3, 10, null],
  );
});

test("mergeSupplementalPlayers: APIにいない途中加入選手を背番号順で補完する", () => {
  const official = parsePlayer(posts[0]!);
  const supplemental: Player = {
    ...official,
    id: 27930,
    number: 21,
    nameJa: "熊澤果歩",
    nameEn: "KUMAZAWA KAHO",
    sourceUrl: "https://anclas.jp/player/熊澤果歩/",
  };

  const result = mergeSupplementalPlayers([official], [supplemental]);

  assert.deepEqual(result.map((player) => player.number), [3, 21]);
  assert.equal(result.filter((player) => player.nameJa === "熊澤果歩").length, 1);
});

test("mergeSupplementalPlayers: 同名の公式プロフィールが取得できたら重複させない", () => {
  const official = { ...parsePlayer(posts[0]!), nameJa: "熊澤果歩", number: 21 };
  const supplemental = { ...official, id: 27930, nickname: "補完値" };

  const result = mergeSupplementalPlayers([official], [supplemental]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, official.id);
  assert.notEqual(result[0]?.nickname, "補完値");
});

test("mergeSupplementalPlayers: 同名の公式プロフィールで欠けた項目だけ補完する", () => {
  const official = {
    ...parsePlayer(posts[0]!),
    number: null,
    position: null,
    nameJa: "熊澤果歩",
    nickname: null,
    photo: { thumbnail: null, medium: null, large: null, full: null },
    personal: [],
  };
  const supplemental: Player = {
    ...official,
    id: 27930,
    number: 21,
    position: "GK",
    nickname: "くま",
    photo: { thumbnail: "thumb", medium: "medium", large: "large", full: "full" },
    personal: [{ label: "MBTI", value: "ESTP-A 起業家" }],
  };

  const result = mergeSupplementalPlayers([official], [supplemental]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, official.id);
  assert.equal(result[0]?.number, 21);
  assert.equal(result[0]?.position, "GK");
  assert.equal(result[0]?.nickname, "くま");
  assert.equal(result[0]?.photo.large, "large");
  assert.deepEqual(result[0]?.personal, supplemental.personal);
});

test("mergeSupplementalPlayers: 補完選手と同じ背番号の旧選手を置き換える", () => {
  const oldPlayer = { ...parsePlayer(posts[0]!), number: 21, nameJa: "旧選手" };
  const supplemental = { ...oldPlayer, id: 27930, nameJa: "熊澤果歩" };

  const result = mergeSupplementalPlayers([oldPlayer], [supplemental]);

  assert.deepEqual(result.map((player) => player.nameJa), ["熊澤果歩"]);
});

test("players.json: 熊澤果歩を公式プロフィール情報付きで1件掲載する", () => {
  const data = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../players.json", import.meta.url)), "utf-8"),
  ) as PlayersData;
  const players = data.players.filter((player) => player.nameJa === "熊澤果歩");

  assert.equal(players.length, 1);
  assert.equal(players[0]?.number, 21);
  assert.equal(players[0]?.position, "GK");
  assert.equal(players[0]?.nickname, "くま");
  assert.equal(players[0]?.profile.bloodType, "A型");
  assert.deepEqual(
    new Set(Object.values(players[0]!.photo)),
    new Set(["https://anclas.jp/wp-content/uploads/2026/09/名称未設定のデザイン-5.png"]),
  );
  assert.equal(
    players[0]?.sourceUrl,
    "https://anclas.jp/player/%e7%86%8a%e6%be%a4%e6%9e%9c%e6%ad%a9/",
  );
  assert.equal(players[0]?.personal.length, 13);
});

test("reconcilePublishedPlayers: 公式一覧から消えた選手だけを除外する", () => {
  const mk = (id: number): Player => ({
    id,
    number: id,
    position: null,
    nameJa: `選手${id}`,
    nameEn: null,
    nickname: null,
    photo: { thumbnail: null, medium: null, large: null, full: null },
    profile: { birthdate: null, hometown: null, height: null, bloodType: null, career: null },
    personal: [],
    sourceUrl: `https://anclas.jp/post-${id}/`,
    blogPosts: [],
    sns: {},
    role: null,
  });
  const players = Array.from({ length: 11 }, (_, index) => mk(index + 1));
  const published = players.slice(0, 10).map((player) => player.sourceUrl);

  const result = reconcilePublishedPlayers(players, published);
  assert.equal(result.players.length, 10);
  assert.deepEqual(result.removed.map((player) => player.id), [11]);
  assert.deepEqual(result.missingUrls, []);
});

test("reconcilePublishedPlayers: 不完全な公式一覧では削除しない", () => {
  const player = parsePlayer(posts[0]!);
  assert.throws(
    () => reconcilePublishedPlayers(Array.from({ length: 18 }, () => player), [player.sourceUrl]),
    /少なすぎます/,
  );
});
