import { existsSync, readFileSync } from "node:fs";
import type { RescheduleInfo } from "./wordpress-client.js";

const VERIFIED_RESCHEDULES_PATH = new URL("../../data/verified-reschedules.json", import.meta.url);

export function loadVerifiedReschedules(): Record<string, RescheduleInfo> {
  if (!existsSync(VERIFIED_RESCHEDULES_PATH)) return {};
  try {
    return JSON.parse(readFileSync(VERIFIED_RESCHEDULES_PATH, "utf-8")) as Record<string, RescheduleInfo>;
  } catch (e) {
    throw new Error(`確認済み代替日程の読み込みに失敗しました: ${e}`);
  }
}
