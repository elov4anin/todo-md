import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { withFileUrls } from "../src/dashboard.js";
import type { ExportRecord } from "../src/domain.js";

function record(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: "TASK-unit",
    kind: "TASK",
    title: "unit",
    file: "todo/TASK-unit.todo.md",
    folder: "active",
    status: "todo",
    type: null,
    priority: null,
    value: null,
    complexity: null,
    epic: null,
    depends_on: [],
    assignee: null,
    author: null,
    created: null,
    due: null,
    started: null,
    completed: null,
    cost_plan: null,
    cost_fact: null,
    first_change: null,
    last_change: null,
    ...overrides,
  };
}

test("withFileUrls: absolute file gets a file:// url", () => {
  const absolute = resolve("/tmp/root", "todo/EPIC-x/TASK-y.todo.md");
  const [derived] = withFileUrls([record({ file: absolute })]);
  assert.equal(derived?.url, pathToFileURL(absolute).href);
});

test("withFileUrls: relative file resolves against base and encodes special characters", () => {
  const file = "todo/EPIC-sp ace/TAS K'qu\"ö.todo.md";
  const [derived] = withFileUrls([record({ file })], "/tmp/root");
  const url = derived?.url ?? "";
  assert.equal(url, pathToFileURL(resolve("/tmp/root", file)).href);
  assert.ok(url.includes("%20"));
  assert.ok(url.includes("%22"));
  assert.ok(url.includes("%C3%B6"));
  assert.ok(!url.includes(" ") && !url.includes('"'));
});

test("withFileUrls: relative file without base gets no url at all", () => {
  const [derived] = withFileUrls([record()]);
  assert.equal("url" in (derived ?? {}), false);
});

test("withFileUrls: input url is never trusted, only re-derived from file", () => {
  const relative = withFileUrls([record({ url: "javascript:alert(1)" })]);
  assert.equal("url" in (relative[0] ?? {}), false);
  const absolute = withFileUrls([record({ file: resolve("/tmp/root", "todo/TASK-unit.todo.md"), url: "javascript:alert(1)" })]);
  assert.match(absolute[0]?.url ?? "", /^file:\/\//u);
  const noFile = withFileUrls([record({ file: "", url: "https://evil.example/x" })]);
  assert.equal("url" in (noFile[0] ?? {}), false);
});
