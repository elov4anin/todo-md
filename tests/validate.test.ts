import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { board, createEpic, createTask, replace, run } from "./support.js";

test("validate: clean board passes", () => {
  const root = board();
  createTask(root);
  assert.equal(run(root, ["validate"]).code, 0);
});

test("validate: missing required field fails", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^priority:.*\n/mu, "");
  const result = run(root, ["validate", file]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /missing front matter field `priority`/u);
});

test("validate: invalid enum fails", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^priority:.*$/mu, "priority: PX");
  assert.match(run(root, ["validate", file]).stdout, /`priority` must be one of/u);
});

test("validate: folder status mismatch fails", () => {
  const root = board();
  const file = createTask(root);
  const target = resolve(root, "todo/done/TASK-example.todo.md");
  renameSync(file, target);
  assert.match(run(root, ["validate", target]).stdout, /todo\/done/u);
});

test("validate: correct folder passes", () => {
  const root = board();
  createTask(root, "TASK-done", { pr: "https://example.test/pr/1" });
  run(root, ["done", "TASK-done"]);
  assert.equal(run(root, ["validate", resolve(root, "todo/done/TASK-done.todo.md")]).code, 0);
});

test("validate: broken local link fails", () => {
  const root = board();
  const file = createTask(root);
  replace(file, "## 8. Источники (Sources)", "## 8. Источники (Sources)\n\n[missing](missing.md)");
  assert.match(run(root, ["validate", file]).stdout, /broken local markdown link/u);
});

test("validate: template placeholder fails", () => {
  const root = board();
  const file = createTask(root);
  replace(file, "- (заполнить)", "- <решение>");
  assert.match(run(root, ["validate", file]).stdout, /template placeholder/u);
});

test("validate: missing section fails", () => {
  const root = board();
  const file = createTask(root);
  replace(file, "## 6. Самопроверка (Verification)", "## Самопроверка");
  assert.match(run(root, ["validate", file]).stdout, /missing section: Verification/u);
});

test("validate: id mismatch fails", () => {
  const root = board();
  const file = createTask(root);
  replace(file, "# TASK-example:", "# TASK-other:");
  assert.match(run(root, ["validate", file]).stdout, /does not match file ID/u);
});

test("validate: unknown depends_on fails", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^depends_on:.*$/mu, "depends_on: TASK-missing");
  assert.match(run(root, ["validate", file]).stdout, /references unknown ID/u);
});

test("validate: single file resolves depends_on from done/", () => {
  const root = board();
  createTask(root, "TASK-dependency", { pr: "https://example.test/pr/1" });
  run(root, ["done", "TASK-dependency"]);
  const file = createTask(root, "TASK-consumer");
  replace(file, /^depends_on:.*$/mu, "depends_on: TASK-dependency");
  assert.equal(run(root, ["validate", file]).code, 0);
});

test("validate: single file resolves epic from cancelled/", () => {
  const root = board();
  createEpic(root, "EPIC-parent");
  run(root, ["cancel", "EPIC-parent"]);
  const file = createTask(root, "TASK-child");
  replace(file, /^epic:.*$/mu, "epic: EPIC-parent");
  assert.equal(run(root, ["validate", file]).code, 0);
});

test("validate: single file still fails on truly unknown depends_on", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^depends_on:.*$/mu, "depends_on: TASK-never-existed");
  assert.equal(run(root, ["validate", file]).code, 1);
});

test("validate: cancelled dependency is a warning", () => {
  const root = board();
  createTask(root, "TASK-dependency");
  run(root, ["cancel", "TASK-dependency"]);
  const file = createTask(root, "TASK-consumer");
  replace(file, /^depends_on:.*$/mu, "depends_on: TASK-dependency");
  const result = run(root, ["validate", file]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /cancelled task/u);
});

test("validate: epic references work", () => {
  const root = board();
  createEpic(root, "EPIC-parent");
  const file = createTask(root, "TASK-child");
  replace(file, /^epic:.*$/mu, "epic: EPIC-parent");
  assert.equal(run(root, ["validate", file]).code, 0);
});

test("validate: legacy flat epic layout warns, foreign epic directory fails", () => {
  const root = board();
  createEpic(root, "EPIC-parent");
  const flat = createTask(root, "TASK-child");
  replace(flat, /^epic:.*$/mu, "epic: EPIC-parent");
  const legacy = run(root, ["validate", flat]);
  assert.equal(legacy.code, 0);
  assert.match(legacy.stdout, /legacy flat layout/u);
  const foreignDirectory = resolve(root, "todo/EPIC-other");
  mkdirSync(foreignDirectory);
  const foreign = resolve(foreignDirectory, "TASK-child.todo.md");
  renameSync(flat, foreign);
  const invalid = run(root, ["validate", foreign]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stdout, /canonical epic directory/u);
});

test("validate: --help works", () => {
  const result = run(board(), ["validate", "--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /.todo-md.json/u);
});

test("validate: bad author/assignee format is a warning", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^author:.*$/mu, "author: somebody");
  const result = run(root, ["validate", file]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /warning: `author`/u);
});

test("validate: --strict fails on author/assignee violations", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^author:.*$/mu, "author: somebody");
  const result = run(root, ["validate", file, "--strict"]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /error: `author`/u);
});

test("validate: empty assignee is allowed before work and when cancelled", () => {
  const root = board();
  const file = createTask(root);
  assert.equal(run(root, ["validate", file]).code, 0);
  run(root, ["cancel", "TASK-example"]);
  assert.equal(run(root, ["validate", resolve(root, "todo/cancelled/TASK-example.todo.md")]).code, 0);
});

test("validate: empty assignee is rejected after work starts in strict mode", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^status:.*$/mu, "status: in_progress");
  const result = run(root, ["validate", file, "--strict"]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /assignee.*must not be empty/u);
});

test("validate: non-empty assignee is validated even when optional", () => {
  const root = board();
  const file = createTask(root);
  replace(file, /^assignee:.*$/mu, "assignee: Bad Format");
  assert.match(run(root, ["validate", file]).stdout, /warning: `assignee`/u);
});

test("validate: JSON config validates roles and agents", () => {
  const root = board();
  const file = createTask(root);
  writeFileSync(resolve(root, ".todo-md.json"), JSON.stringify({ roles: ["Аналитик"], agents: ["pi"], strict: true }));
  const result = run(root, ["validate", file]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /role `Разработчик` is not in/u);
  assert.match(result.stdout, /agent `codex` is not a known agent/u);
});

test("validate: explicit config path", () => {
  const root = board();
  const file = createTask(root);
  const config = resolve(root, "custom.json");
  writeFileSync(config, JSON.stringify({ roles: ["Разработчик"], agents: ["codex"], strict: true }));
  assert.equal(run(root, ["validate", file, `--config=${config}`]).code, 0);
});

test("validate: malformed JSON config fails clearly", () => {
  const root = board();
  createTask(root);
  writeFileSync(resolve(root, ".todo-md.json"), "{");
  const result = run(root, ["validate"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /invalid JSON config/u);
});

test("validate: preserves CRLF files", () => {
  const root = board();
  const file = createTask(root);
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("\n", "\r\n"));
  assert.equal(run(root, ["set", "TASK-example", "priority=P1"]).code, 0);
  assert.match(readFileSync(file, "utf8"), /\r\n/u);
});

test("validate: ignores symlink-free auxiliary directories", () => {
  const root = board();
  mkdirSync(resolve(root, "docs"));
  createTask(root);
  assert.equal(run(root, ["validate"]).code, 0);
});
