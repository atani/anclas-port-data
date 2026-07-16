import assert from "node:assert/strict";
import { test } from "node:test";
import { MATCH_RESULTS_TOPIC, sendResultNotifications } from "../src/lib/fcm.js";
import type { ResultNotification } from "../src/lib/result-diff.js";

const sample: ResultNotification[] = [
  { matchId: "su-post-1", title: "試合終了", body: "アンクラス 2 - 1 水俣ユニオン" },
];

const serviceAccount = JSON.stringify({
  project_id: "anclas-port",
  client_email: "sa@anclas-port.iam.gserviceaccount.com",
  private_key: "dummy",
});

test("sendResultNotifications: 秘密未設定なら送信をスキップ", async () => {
  const r = await sendResultNotifications(sample, { serviceAccountJson: "" });
  assert.equal(r.skipped, true);
  assert.equal(r.sent, 0);
});

test("sendResultNotifications: 通知が空なら送信しない", async () => {
  const r = await sendResultNotifications([], {
    serviceAccountJson: serviceAccount,
    getAccessToken: async () => "tok",
    fetchImpl: (async () => {
      throw new Error("fetch は呼ばれないはず");
    }) as unknown as typeof fetch,
  });
  assert.equal(r.skipped, false);
  assert.equal(r.sent, 0);
});

test("sendResultNotifications: fetch をモックしてトピックへ送信", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const r = await sendResultNotifications(sample, {
    serviceAccountJson: serviceAccount,
    getAccessToken: async () => "access-token-xyz",
    fetchImpl,
  });

  assert.equal(r.skipped, false);
  assert.equal(r.sent, 1);
  assert.equal(r.failed, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://fcm.googleapis.com/v1/projects/anclas-port/messages:send");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer access-token-xyz");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.equal(body.message.topic, MATCH_RESULTS_TOPIC);
  assert.equal(body.message.notification.title, "試合終了");
  assert.equal(body.message.notification.body, "アンクラス 2 - 1 水俣ユニオン");
  assert.equal(body.message.data.matchId, "su-post-1");
});

test("sendResultNotifications: 送信失敗は failed に計上（例外にしない）", async () => {
  const fetchImpl = (async () =>
    new Response("boom", { status: 400 })) as unknown as typeof fetch;
  const r = await sendResultNotifications(sample, {
    serviceAccountJson: serviceAccount,
    getAccessToken: async () => "tok",
    fetchImpl,
  });
  assert.equal(r.sent, 0);
  assert.equal(r.failed, 1);
});
