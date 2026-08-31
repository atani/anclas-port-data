import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStaff } from "../src/lib/staff-parser.js";

test("parseStaff: 公式スタッフカードから役職・氏名・写真を掲載順に抽出する", () => {
  const html = `
    <ul class="c-staff-list">
      <li class="c-staff-list__item fade">
        <div class="c-staff-card">
          <img class="c-staff-card__image u-image-cover" src="/wp-content/uploads/ueda.jpeg" alt="上田涼斗">
          <span class="c-staff-card__role">トップチーム監督</span>
          <h2 class="c-staff-card__name">上田涼斗</h2>
        </div>
      </li>
      <li class="c-staff-list__item fade">
        <div class="c-staff-card">
          <img data-src="https://anclas.jp/wp-content/uploads/kurosawa.jpeg" class="c-staff-card__image">
          <span class="c-staff-card__role">ヘッドコーチ兼<br>アカデミーダイレクター</span>
          <h2 class="c-staff-card__name">黒澤 怜</h2>
        </div>
      </li>
    </ul>`;

  assert.deepEqual(parseStaff(html), [
    {
      name: "上田涼斗",
      role: "トップチーム監督",
      photoUrl: "https://anclas.jp/wp-content/uploads/ueda.jpeg",
    },
    {
      name: "黒澤 怜",
      role: "ヘッドコーチ兼 アカデミーダイレクター",
      photoUrl: "https://anclas.jp/wp-content/uploads/kurosawa.jpeg",
    },
  ]);
});

test("parseStaff: 氏名か役職が欠けるカードを除外する", () => {
  assert.deepEqual(
    parseStaff('<li class="c-staff-list__item"><h2 class="c-staff-card__name">氏名のみ</h2></li>'),
    [],
  );
});
