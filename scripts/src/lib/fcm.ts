import { GoogleAuth } from "google-auth-library";
import { logger } from "./logger.js";
import type { RemoteNotification } from "./remote-notification.js";
export {
  EVENT_ANNOUNCEMENTS_TOPIC,
  MATCH_RESULTS_TOPIC,
  NEW_PODCAST_TOPIC,
} from "./remote-notification.js";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** サービスアカウント JSON のうち利用する項目 */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface SendResult {
  /** 秘密未設定などで送信自体を行わなかった場合 true */
  skipped: boolean;
  sent: number;
  failed: number;
}

export interface SendOptions {
  /** サービスアカウント JSON の中身。省略時は環境変数 FCM_SERVICE_ACCOUNT_JSON */
  serviceAccountJson?: string;
  /** テスト用に fetch を差し替える */
  fetchImpl?: typeof fetch;
  /** テスト用にトークン取得を差し替える。省略時は google-auth-library を使う */
  getAccessToken?: (credentials: ServiceAccount) => Promise<string | null | undefined>;
}

async function defaultGetAccessToken(
  credentials: ServiceAccount,
): Promise<string | null | undefined> {
  const auth = new GoogleAuth({ credentials, scopes: [FCM_SCOPE] });
  return auth.getAccessToken();
}

/**
 * FCM HTTP v1 API で通知ごとに指定されたトピックへ送る。
 *
 * FCM_SERVICE_ACCOUNT_JSON（またはオプション）が未設定なら送信せず
 * 正常終了する（skipped: true）。CI で secret 未設定でも fail させないため。
 */
export async function sendNotifications(
  notifications: RemoteNotification[],
  options: SendOptions = {},
): Promise<SendResult> {
  const raw = options.serviceAccountJson ?? process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.trim() === "") {
    logger.info("FCM_SERVICE_ACCOUNT_JSON 未設定のため通知の送信をスキップします");
    return { skipped: true, sent: 0, failed: 0 };
  }
  if (notifications.length === 0) {
    return { skipped: false, sent: 0, failed: 0 };
  }

  let credentials: ServiceAccount;
  try {
    credentials = JSON.parse(raw) as ServiceAccount;
  } catch (e) {
    throw new Error(
      `FCM_SERVICE_ACCOUNT_JSON の JSON 解析に失敗: ${e instanceof Error ? e.message : e}`,
    );
  }
  if (!credentials.project_id) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON に project_id がありません");
  }

  const getAccessToken = options.getAccessToken ?? defaultGetAccessToken;
  const accessToken = await getAccessToken(credentials);
  if (!accessToken) throw new Error("FCM アクセストークンの取得に失敗しました");

  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`;
  let sent = 0;
  let failed = 0;
  for (const n of notifications) {
    const payload = {
      message: {
        topic: n.topic,
        notification: { title: n.title, body: n.body },
        data: n.data,
      },
    };
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      sent++;
      logger.info(`通知を送信 topic=${n.topic}: ${n.body}`);
    } else {
      failed++;
      const text = await res.text().catch(() => "");
      logger.warn(`通知の送信に失敗 (${res.status}): ${text.slice(0, 200)}`);
    }
  }
  return { skipped: false, sent, failed };
}
