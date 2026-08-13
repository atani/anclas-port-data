import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { RemoteNotification } from "./remote-notification.js";

/**
 * 結果通知キューの場所（scripts/notify-queue.json）。
 * リポジトリ直下には置かない（commit 対象外・アプリ配信対象外にするため）。
 * 生成ステップが書き出し、通知ステップが読み取る受け渡しファイル。
 */
export const NOTIFY_QUEUE_URL = new URL("../../notify-queue.json", import.meta.url);

export function writeNotifyQueue(notifications: RemoteNotification[]): void {
  writeFileSync(NOTIFY_QUEUE_URL, `${JSON.stringify(notifications, null, 2)}\n`, "utf-8");
}

export function readNotifyQueue(): RemoteNotification[] {
  if (!existsSync(NOTIFY_QUEUE_URL)) return [];
  try {
    const parsed = JSON.parse(readFileSync(NOTIFY_QUEUE_URL, "utf-8"));
    return Array.isArray(parsed) ? (parsed as RemoteNotification[]) : [];
  } catch {
    return [];
  }
}
