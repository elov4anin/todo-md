import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { board, createEpic, createTask, field, run } from "./support.js";

test("create: task skeleton validates", () => {
  const root = board();
  const file = createTask(root, "TASK-feature-name");
  assert.equal(run(root, ["validate", file]).code, 0);
});

test("create: epic skeleton validates", () => {
  const root = board();
  assert.equal(run(root, ["validate", createEpic(root, "EPIC-big-thing")]).code, 0);
});

test("create: collision rejected", () => {
  const root = board();
  createTask(root);
  const result = run(root, ["create", "TASK-example", "--type=feat", "--author=Разработчик (codex)"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already exists/u);
});

test("create: bad ID rejected", () => {
  const result = run(board(), ["create", "task_Bad", "--type=feat", "--author=Разработчик (codex)"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /kebab-case/u);
});

test("create: missing type rejected for tasks", () => {
  const result = run(board(), ["create", "TASK-no-type", "--author=Разработчик (codex)"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--type is required/u);
});

test("create: backlog status places in backlog/", () => {
  const root = board();
  const result = run(root, ["create", "TASK-later", "--type=chore", "--author=Разработчик (codex)", "--status=backlog"]);
  assert.equal(result.code, 0);
  assert.ok(existsSync(resolve(root, "todo/backlog/TASK-later.todo.md")));
});

test("create: custom metadata applied", () => {
  const root = board();
  const result = run(root, ["create", "TASK-custom", "--type=fix", "--author=Разработчик (codex)", "--priority=P0", "--value=V4", "--complexity=C1"]);
  assert.equal(result.code, 0);
  const file = resolve(root, "todo/TASK-custom.todo.md");
  assert.equal(field(file, "priority"), "P0");
  assert.equal(field(file, "value"), "V4");
});

test("export: produces valid JSONL", () => {
  const root = board();
  createTask(root);
  createEpic(root);
  const result = run(root, ["export-jsonl"]);
  assert.equal(result.code, 0);
  const records = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as unknown);
  assert.equal(records.length, 2);
});

test("export: record fields", () => {
  const root = board();
  createTask(root, "TASK-fields", { priority: "P1" });
  const result = run(root, ["export-jsonl"]);
  const record = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(record.id, "TASK-fields");
  assert.equal(record.kind, "TASK");
  assert.equal(record.priority, "P1");
  assert.deepEqual(record.depends_on, []);
});

test("export: folder detection", () => {
  const root = board();
  const file = createTask(root, "TASK-done-folder", { pr: "https://example.test/pr/1" });
  assert.ok(existsSync(file));
  assert.equal(run(root, ["done", "TASK-done-folder"]).code, 0);
  const record = JSON.parse(run(root, ["export-jsonl"]).stdout) as Record<string, unknown>;
  assert.equal(record.folder, "done");
});

test("export: --help works", () => {
  const result = run(board(), ["export-jsonl", "--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /JSON Lines/u);
});

test("export: supports output file", () => {
  const root = board();
  createTask(root);
  const output = resolve(root, "tasks.jsonl");
  assert.equal(run(root, ["export-jsonl", "-o", output]).code, 0);
  assert.match(readFileSync(output, "utf8"), /TASK-example/u);
});
