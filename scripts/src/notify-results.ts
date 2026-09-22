import { sendNotifications } from "./lib/fcm.js";
import { logger } from "./lib/logger.js";
import { readNotifyQueue } from "./lib/notify-queue.js";

/**
 * 生成ステップが書き出した通知キュー（notify-queue.json）を読み、
 * 通知ごとに指定された FCM トピックへ送信する。
 * 認証設定の欠落や送信失敗は異常終了として扱う。
 */
async function main(): Promise<void> {
  const notifications = readNotifyQueue();
  if (notifications.length === 0) {
    logger.info("通知キューが空です。送信をスキップします。");
    return;
  }

  const result = await sendNotifications(notifications);
  if (result.failed > 0) {
    throw new Error(`通知の送信に失敗しました: ${result.failed}件`);
  }
  logger.info(`リモート通知: 送信${result.sent}件 / 失敗${result.failed}件`);
}

main().catch((err) => {
  logger.error(`結果通知の送信に失敗: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
