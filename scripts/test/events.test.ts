import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, message: string): UnknownRecord {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), message);
  return value as UnknownRecord;
}

function requiredString(record: UnknownRecord, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`${context}.${key} must be a string`);
  }
  assert.ok(value.length > 0, `${context}.${key} must not be empty`);
  return value;
}

function validHttpsURL(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

test("events.json contains valid limited-time events", async () => {
  const fileURL = new URL("../../events.json", import.meta.url);
  const feed = asRecord(JSON.parse(await readFile(fileURL, "utf8")), "feed must be an object");
  assert.ok(Array.isArray(feed.items), "feed.items must be an array");

  const ids = new Set<string>();
  for (const [index, rawItem] of feed.items.entries()) {
    const context = `items[${index}]`;
    const item = asRecord(rawItem, `${context} must be an object`);
    const id = requiredString(item, "id", context);
    assert.ok(!ids.has(id), `${context}.id must be unique`);
    ids.add(id);

    requiredString(item, "title", context);
    requiredString(item, "actionTitle", context);
    const actionURL = requiredString(item, "actionUrl", context);
    assert.ok(validHttpsURL(actionURL), `${context}.actionUrl must be an HTTPS URL`);
    if (item.imageUrl !== undefined) {
      assert.equal(typeof item.imageUrl, "string", `${context}.imageUrl must be a string`);
      assert.ok(validHttpsURL(item.imageUrl as string), `${context}.imageUrl must be an HTTPS URL`);
    }

    const startsAt = requiredString(item, "startsAt", context);
    const endsAt = requiredString(item, "endsAt", context);
    assert.match(startsAt, /(Z|[+-]\d{2}:\d{2})$/, `${context}.startsAt needs a timezone`);
    assert.match(endsAt, /(Z|[+-]\d{2}:\d{2})$/, `${context}.endsAt needs a timezone`);
    const startTime = Date.parse(startsAt);
    const endTime = Date.parse(endsAt);
    assert.ok(Number.isFinite(startTime), `${context}.startsAt must be a valid date`);
    assert.ok(Number.isFinite(endTime), `${context}.endsAt must be a valid date`);
    assert.ok(startTime < endTime, `${context}.endsAt must be later than startsAt`);

    assert.equal(typeof item.priority, "number", `${context}.priority must be a number`);
  }
});
