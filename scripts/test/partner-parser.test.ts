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
  // 現時点で85社。サイト更新で増減するため下限のみ検証して壊れにくくする。
  assert.ok(partners.length >= 50, `パートナー数 ${partners.length}`);

  // ロゴは全て anclas.jp の uploads を指す
  for (const p of partners) {
    assert.match(p.logoUrl, /^https:\/\/anclas\.jp\/wp-content\/uploads\//);
  }
  // 大半にリンクが設定されている
  const linked = partners.filter((p) => p.url).length;
  assert.ok(linked > partners.length * 0.8, `リンクあり ${linked}/${partners.length}`);

  // 先頭は TRES（リンク・ロゴ・社名が取れている）
  const tres = partners.find((p) => p.logoUrl.endsWith("/TRES.png"));
  assert.ok(tres, "TRES のロゴが取れている");
  assert.match(tres!.url, /^https:\/\/tres\.co\.jp\//);
  assert.equal(tres!.name, "株式会社トレス");
});

test("parsePartners: 雇用サポート企業を取り込まない", () => {
  const partners = parsePartners(topFix);
  // SPONSOR セクションは「オフィシャルパートナー」と「雇用サポート企業」に分かれる。
  // アプリが出すのは前者だけなので、後者のロゴが混ざってはいけない。
  assert.ok(topFix.includes("雇用サポート企業"), "fixture に両グループがある");
  for (const needle of ["ADAL", "志水ミート", "universal"]) {
    assert.ok(
      !partners.some((p) => new RegExp(needle, "i").test(`${p.name} ${p.logoUrl}`)),
      `${needle} を含まない`,
    );
  }
});

test("parsePartners: 外部サイトが無いパートナーもロゴを残す", () => {
  const partners = parsePartners(topFix);
  // サイト側は anclas.jp のパートナー紹介ページへ飛ばしている。
  // アプリは url が空ならリンクを張らずロゴだけ出すので、候補からは落とさない。
  const bono = partners.find((p) => p.name === "BONO");
  assert.ok(bono, "BONO が候補に残る");
  assert.equal(bono!.url, "");
  assert.ok(!partners.some((p) => /anclas\.jp\/partner/.test(p.url)), "自サイトURLは残さない");
});

test("parsePartners: グループ外のロゴを拾わない", () => {
  const html = `
    <div class="c-sponsor__group">
      <h3 class="c-sponsor__group-label"><span>オフィシャルパートナー</span></h3>
      <ul class="c-sponsor__list">
        <li class="c-sponsor__item"><a class="c-sponsor-card" href="https://example.com/"><img class="u-image-contain" src="https://anclas.jp/wp-content/uploads/2026/08/example.png" alt="例株式会社"></a></li>
        <li class="c-sponsor__item"><a class="c-sponsor-card" href=""><img class="u-image-contain" src="https://anclas.jp/wp-content/uploads/2026/08/nolink.png" alt="リンク無し社"></a></li>
        <li class="c-sponsor__item"><a class="c-sponsor-card" href="https://nologo.example.com/"><img class="u-image-contain" src="https://anclas.jp/wp-content/themes/logo.png" alt="テーマ画像"></a></li>
      </ul>
    </div>
    <div class="c-sponsor__group">
      <h3 class="c-sponsor__group-label"><span>雇用サポート企業</span></h3>
      <ul class="c-sponsor__list">
        <li class="c-sponsor__item"><a class="c-sponsor-card" href="https://hire.example.com/"><img class="u-image-contain" src="https://anclas.jp/wp-content/uploads/2026/08/hire.png" alt="雇用社"></a></li>
      </ul>
    </div>
  `;
  const partners = parsePartners(html);

  assert.equal(partners.length, 2);
  assert.deepEqual(
    partners.map((p) => [p.name, p.url]),
    [
      ["例株式会社", "https://example.com/"],
      ["リンク無し社", ""],
    ],
  );
});

test("parsePartners: 旧構造でも壊れない", () => {
  // リニューアル前の DOM。data-src と <footer> 区切りで、自サイトリンクはノイズ。
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
  assert.equal(partners[0]!.url, "https://example.com/");
  assert.equal(partners[0]!.name, "example"); // alt 空 → ファイル名補完
  assert.equal(partners[1]!.url, "");
  assert.equal(partners[1]!.name, "リンク無し社");
});

test("parsePartners: 見出しが無ければ空配列", () => {
  assert.deepEqual(parsePartners("<h3>NO SECTION</h3><footer></footer>"), []);
});
