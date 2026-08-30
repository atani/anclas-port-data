import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { sendNotifications } from "./lib/fcm.js";
import { logger } from "./lib/logger.js";
import {
  buildEventNotification,
  detectNewActiveEvents,
  type EventAnnouncement,
} from "./lib/remote-notification.js";

interface EventFeed {
  items: EventAnnouncement[];
}

function readCurrentFeed(): EventFeed {
  const url = new URL("../../events.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as EventFeed;
}

function readPreviousFeed(beforeSha: string): EventFeed | undefined {
  if (!/^[0-9a-f]{40}$/i.test(beforeSha) || /^0+$/.test(beforeSha)) return undefined;
  try {
    const raw = execFileSync("git", ["show", `${beforeSha}:events.json`], {
      encoding: "utf-8",
    });
    return JSON.parse(raw) as EventFeed;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const previous = readPreviousFeed(process.env.BEFORE_SHA ?? "");
  const current = readCurrentFeed();
  const events = detectNewActiveEvents(previous?.items, current.items);
  if (events.length === 0) {
    logger.info("新規の公開中イベントがないため通知をスキップします。");
    return;
  }

  const result = await sendNotifications(events.map(buildEventNotification));
  if (result.skipped) return;
  if (result.failed > 0) {
    throw new Error(`イベント通知の送信に失敗しました: ${result.failed}件`);
  }
  logger.info(`イベント通知: 送信${result.sent}件`);
}

main().catch((error) => {
  logger.error(
    `イベント通知に失敗: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
