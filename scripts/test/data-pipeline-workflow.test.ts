import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/data-pipeline.yml", import.meta.url),
  "utf-8",
);

test("data pipeline commits generated news", () => {
  const statusLine = workflow
    .split("\n")
    .find((line) => line.includes("git status --porcelain"));
  const addLine = workflow.split("\n").find((line) => line.includes("git add --"));

  assert.ok(statusLine?.includes("news.json"), "news.json must be checked for changes");
  assert.ok(addLine?.includes("news.json"), "news.json must be staged for publishing");
});

test("data pipeline stops before commit when news consistency check fails", () => {
  assert.match(workflow, /^\s+npm run generate:news\s*$/m);
  assert.doesNotMatch(workflow, /generate:news\s*\|\|/);
});
