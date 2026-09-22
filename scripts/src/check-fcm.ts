import { MATCH_RESULTS_TOPIC, sendNotifications } from "./lib/fcm.js";
import { logger } from "./lib/logger.js";

// データを確定済みに更新する前に、実配信せず認証と送信権限を確認する。
sendNotifications([{
  topic: MATCH_RESULTS_TOPIC,
  title: "通知設定の検証",
  body: "配信しない検証用メッセージです",
  data: { type: "match-result", matchId: "configuration-check" },
}], { validateOnly: true }).then((result) => {
  if (result.failed > 0) throw new Error("FCM送信設定の検証に失敗しました");
}).catch((error) => {
  logger.error(error instanceof Error ? error.message : "FCM送信設定の検証に失敗しました");
  process.exitCode = 1;
});
