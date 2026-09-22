import assert from "node:assert/strict";
import { test } from "node:test";
import { MATCH_RESULTS_TOPIC, sendNotifications } from "../src/lib/fcm.js";
import type { RemoteNotification } from "../src/lib/remote-notification.js";

const sample: RemoteNotification[] = [
  {
    topic: MATCH_RESULTS_TOPIC,
    title: "試合終了",
    body: "アンクラス 2 - 1 水俣ユニオン",
    data: { type: "match-result", matchId: "su-post-1" },
  },
];

const serviceAccount = JSON.stringify({
  project_id: "anclas-port",
  client_email: "sa@anclas-port.iam.gserviceaccount.com",
  private_key: "dummy",
});

test("sendResultNotifications: 秘密未設定は異常終了する", async () => {
  await assert.rejects(sendNotifications(sample, { serviceAccountJson: "" }), /未設定/);
});

test("sendResultNotifications: 通知が空なら送信しない", async () => {
  const r = await sendNotifications([], {
    serviceAccountJson: serviceAccount,
    getAccessToken: async () => "tok",
    fetchImpl: (async () => {
      throw new Error("fetch は呼ばれないはず");
    }) as unknown as typeof fetch,
  });
  assert.equal(r.sent, 0);
});

test("sendResultNotifications: fetch をモックしてトピックへ送信", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const r = await sendNotifications(sample, {
    serviceAccountJson: serviceAccount,
    getAccessToken: async () => "access-token-xyz",
    fetchImpl,
  });

  assert.equal(r.sent, 1);
  assert.equal(r.failed, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://fcm.googleapis.com/v1/projects/anclas-port/messages:send");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer access-token-xyz");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.equal(body.validate_only, undefined);
  assert.equal(body.message.topic, MATCH_RESULTS_TOPIC);
  assert.equal(body.message.notification.title, "試合終了");
  assert.equal(body.message.notification.body, "アンクラス 2 - 1 水俣ユニオン");
  assert.equal(body.message.data.matchId, "su-post-1");
});

test("sendResultNotifications: 送信失敗は failed に計上（例外にしない）", async () => {
  const fetchImpl = (async () =>
    new Response("boom", { status: 400 })) as unknown as typeof fetch;
  const r = await sendNotifications(sample, {
    serviceAccountJson: serviceAccount,
    getAccessToken: async () => "tok",
    fetchImpl,
  });
  assert.equal(r.sent, 0);
  assert.equal(r.failed, 1);
});

test("sendNotifications: 検証モードではFCMへ非配信の検証を要求する", async () => {
  const result = await sendNotifications(sample, {
    serviceAccountJson: serviceAccount,
    validateOnly: true,
    getAccessToken: async () => "tok",
    fetchImpl: (async (_url: unknown, init: RequestInit) => {
      const payload = JSON.parse(init.body as string);
      assert.equal(payload.validate_only, true);
      assert.equal(payload.message.topic, MATCH_RESULTS_TOPIC);
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(result.failed, 0);
});

test("sendNotifications: 不正な認証設定の内容をエラーへ露出しない", async () => {
  for (const raw of ['{"private_key":"sensitive-value",', "null", "{}", '{"project_id":123}']) {
    await assert.rejects(sendNotifications(sample, { serviceAccountJson: raw }), (error: Error) => {
      assert.doesNotMatch(error.message, /sensitive-value/);
      assert.match(error.message, /FCM_SERVICE_ACCOUNT_JSON/);
      return true;
    });
  }
});
