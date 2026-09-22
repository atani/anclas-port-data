import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

function runNotificationCli(entrypoint: string, status: number, credentials?: string) {
  const directory = mkdtempSync(join(tmpdir(), "anclas-notification-test-"));
  try {
    mkdirSync(join(directory, "src/lib"), { recursive: true });
    for (const file of [entrypoint, "lib/fcm.ts", "lib/logger.ts", "lib/remote-notification.ts", "lib/notify-queue.ts"]) {
      copyFileSync(new URL(`../src/${file}`, import.meta.url), join(directory, "src", file));
    }
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(directory, "node_modules"), "dir");
    writeFileSync(join(directory, "notify-queue.json"), JSON.stringify([{
      topic: "match-results", title: "試合終了", body: "1 - 0", data: { matchId: "test" },
    }]));
    // 実際のCLIを起動し、外部通信だけを置き換えて終了コードと非配信指定を確認する。
    writeFileSync(join(directory, "mock.mjs"), `
      import { GoogleAuth } from 'google-auth-library';
      GoogleAuth.prototype.getAccessToken = async () => 'test-token';
      globalThis.fetch = async (_url, init) => {
        console.log('FCM_PAYLOAD=' + init.body);
        return new Response('{}', { status: ${status} });
      };
    `);
    return spawnSync(process.execPath, ["--import", "tsx", "--import", "./mock.mjs", `src/${entrypoint}`], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        FCM_SERVICE_ACCOUNT_JSON: credentials ?? JSON.stringify({
          project_id: "test-project", client_email: "test@example.com", private_key: "test-key",
        }),
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("check:fcm CLIは検証メッセージを実配信しない", () => {
  const result = runNotificationCli("check-fcm.ts", 200);
  assert.equal(result.status, 0, result.stderr);
  const payloadLine = result.stdout.split("\n").find((line) => line.startsWith("FCM_PAYLOAD="));
  assert.ok(payloadLine);
  const payload = JSON.parse(payloadLine.slice("FCM_PAYLOAD=".length));
  assert.equal(payload.validate_only, true);
  assert.equal(payload.message.topic, "match-results");
  assert.match(result.stdout, /通知設定の検証に成功/);
});

for (const entrypoint of ["check-fcm.ts", "notify-results.ts"]) {
  test(`${entrypoint}: FCMが拒否したら終了コード1になる`, () => {
    const result = runNotificationCli(entrypoint, 403);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /失敗/);
  });
  test(`${entrypoint}: 認証未設定なら通信せず終了コード1になる`, () => {
    const result = runNotificationCli(entrypoint, 200, "");
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /未設定/);
    assert.doesNotMatch(result.stdout, /FCM_PAYLOAD/);
  });
}
