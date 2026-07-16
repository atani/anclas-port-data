import { sendResultNotifications } from "./lib/fcm.js";
import { logger } from "./lib/logger.js";
import { readNotifyQueue } from "./lib/notify-queue.js";

/**
 * 生成ステップが書き出した結果通知キュー（notify-queue.json）を読み、
 * FCM トピック match-results へ送信する。
 * FCM_SERVICE_ACCOUNT_JSON 未設定なら送信をスキップして正常終了する。
 */
async function main(): Promise<void> {
  const notifications = readNotifyQueue();
  if (notifications.length === 0) {
    logger.info("結果通知キューが空です。送信をスキップします。");
    return;
  }

  const result = await sendResultNotifications(notifications);
  if (result.skipped) return;
  logger.info(`結果通知: 送信${result.sent}件 / 失敗${result.failed}件`);
}

main().catch((err) => {
  logger.error(`結果通知の送信に失敗: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
