import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsePartners } from "../src/lib/partner-parser.js";

const topFix = readFileSync(
  fileURLToPath(new URL("./fixtures/anclas-top.html", import.meta.url)),
  "utf-8",
);

test("parsePartners: 実fixtureからパートナーを抽出（下限チェック）", () => {
  const partners = parsePartners(topFix);
  // 現時点で約77社。サイト更新で増減するため下限のみ検証して壊れにくくする。
  assert.ok(partners.length >= 50, `パートナー数 ${partners.length}`);

  // ロゴは全て anclas.jp の uploads を指す
  for (const p of partners) {
    assert.match(p.logoUrl, /^https:\/\/anclas\.jp\/wp-content\/uploads\//);
  }
  // 大半にリンクが設定されている
  const linked = partners.filter((p) => p.url).length;
  assert.ok(linked > partners.length * 0.8, `リンクあり ${linked}/${partners.length}`);

  // 先頭は TRES（リンク・ロゴが取れている）
  const tres = partners.find((p) => p.logoUrl.endsWith("/TRES.png"));
  assert.ok(tres, "TRES のロゴが取れている");
  assert.match(tres!.url, /^https:\/\/tres\.co\.jp\//);
});

test("parsePartners: 見出しより前の「募集」CTAを取り込まない", () => {
  const partners = parsePartners(topFix);
  // 募集バナー画像（IMG_5749）は見出しより前にあるため含まれない
  assert.ok(!partners.some((p) => /IMG_5749/.test(p.logoUrl)), "募集バナーを除外");
});

test("parsePartners: anclas.jp 自身へのリンクとロゴ無しを除外", () => {
  const html = `
    <h3>オフィシャルパートナー</h3>
    <div class="dp_sc_fl_item"><a href="https://example.com/"><img class="lazyload" src="data:image/png;base64,AAA" alt="" data-src="https://anclas.jp/wp-content/uploads/2026/01/example.png"></a></div>
    <div class="dp_sc_fl_item"><a href="https://anclas.jp/map"><img src="data:image/png;base64,AAA" data-src="https://anclas.jp/wp-content/uploads/2026/01/map.png"></a></div>
    <div class="dp_sc_fl_item"><a href="https://nologo.example.com/"><img src="data:image/png;base64,AAA"></a></div>
    <div class="dp_sc_fl_item"><a href=""><img src="data:image/png;base64,AAA" alt="リンク無し社" data-src="https://anclas.jp/wp-content/uploads/2026/01/nolink.png"></a></div>
    <footer></footer>
  `;
  const partners = parsePartners(html);
  assert.equal(partners.length, 2);
  // 1件目: 通常
  assert.equal(partners[0]!.url, "https://example.com/");
  assert.equal(partners[0]!.name, "example"); // alt 空 → ファイル名補完
  // 2件目: href 空でもロゴ表示のため残す（url は空文字、name は alt）
  assert.equal(partners[1]!.url, "");
  assert.equal(partners[1]!.name, "リンク無し社");
});

test("parsePartners: 見出しが無ければ空配列", () => {
  assert.deepEqual(parsePartners("<h3>NO SECTION</h3><footer></footer>"), []);
});
