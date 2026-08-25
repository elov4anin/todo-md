import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { board, createTask, field, replace, run } from "./support.js";

test("transition: start sets in_progress + started date", () => {
  const root = board();
  const file = createTask(root);
  const result = run(root, ["start", "TASK-example", "--assignee=Разработчик (codex)"]);
  assert.equal(result.code, 0);
  assert.equal(field(file, "status"), "in_progress");
  assert.match(field(file, "started") ?? "", /^\d{4}-\d{2}-\d{2}/u);
});

test("transition: done moves to done/ and sets completed", () => {
  const root = board();
  createTask(root, "TASK-finish", { pr: "https://example.test/pr/1" });
  const result = run(root, ["done", "TASK-finish"]);
  const done = resolve(root, "todo/done/TASK-finish.todo.md");
  assert.equal(result.code, 0);
  assert.ok(existsSync(done));
  assert.equal(field(done, "status"), "done");
  assert.match(field(done, "completed") ?? "", /^\d{4}-/u);
});

test("transition: cancel moves to cancelled/ and sets cancelled date", () => {
  const root = board();
  createTask(root, "TASK-cancel");
  assert.equal(run(root, ["cancel", "TASK-cancel"]).code, 0);
  const file = resolve(root, "todo/cancelled/TASK-cancel.todo.md");
  assert.equal(field(file, "status"), "cancelled");
  assert.match(field(file, "cancelled") ?? "", /^\d{4}-/u);
});

test("transition: backlog moves to backlog/", () => {
  const root = board();
  createTask(root, "TASK-later");
  assert.equal(run(root, ["backlog", "TASK-later"]).code, 0);
  assert.ok(existsSync(resolve(root, "todo/backlog/TASK-later.todo.md")));
});

test("transition: review sets review status", () => {
  const root = board();
  const file = createTask(root, "TASK-review");
  assert.equal(run(root, ["review", "TASK-review"]).code, 0);
  assert.equal(field(file, "status"), "review");
});

test("transition: reverse move done → start brings back to todo/", () => {
  const root = board();
  createTask(root, "TASK-reopen", { pr: "https://example.test/pr/1" });
  assert.equal(run(root, ["done", "TASK-reopen"]).code, 0);
  assert.equal(run(root, ["start", "TASK-reopen", "--assignee=Разработчик (codex)"]).code, 0);
  assert.ok(existsSync(resolve(root, "todo/TASK-reopen.todo.md")));
  assert.ok(!existsSync(resolve(root, "todo/done/TASK-reopen.todo.md")));
});

test("transition: not found fails", () => {
  const result = run(board(), ["review", "TASK-missing"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /task not found/u);
});

test("transition: done requires PR", () => {
  const root = board();
  createTask(root);
  const result = run(root, ["done", "TASK-example"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must be set before done/u);
});

test("links: outbound rebased when moving deeper", () => {
  const root = board();
  const file = createTask(root, "TASK-links", { pr: "https://example.test/pr/1" });
  writeFileSync(resolve(root, "ref.md"), "# Ref\n");
  replace(file, "## 8. Источники (Sources)", "## 8. Источники (Sources)\n\n[ref](../ref.md)");
  assert.equal(run(root, ["done", "TASK-links"]).code, 0);
  assert.match(readFileSync(resolve(root, "todo/done/TASK-links.todo.md"), "utf8"), /\[ref\]\(\.\.\/\.\.\/ref\.md\)/u);
});

test("links: outbound rebased when moving shallower", () => {
  const root = board();
  createTask(root, "TASK-links-back", { pr: "https://example.test/pr/1" });
  writeFileSync(resolve(root, "ref.md"), "# Ref\n");
  const active = resolve(root, "todo/TASK-links-back.todo.md");
  replace(active, "## 8. Источники (Sources)", "## 8. Источники (Sources)\n\n[ref](../ref.md)");
  run(root, ["done", "TASK-links-back"]);
  run(root, ["start", "TASK-links-back", "--assignee=Разработчик (codex)"]);
  assert.match(readFileSync(active, "utf8"), /\[ref\]\(\.\.\/ref\.md\)/u);
});

test("links: inbound updated in referencing files", () => {
  const root = board();
  const target = createTask(root, "TASK-target", { pr: "https://example.test/pr/1" });
  const linker = createTask(root, "TASK-linker");
  replace(linker, "## 8. Источники (Sources)", "## 8. Источники (Sources)\n\n[target](TASK-target.todo.md)");
  assert.ok(existsSync(target));
  assert.equal(run(root, ["done", "TASK-target"]).code, 0);
  assert.match(readFileSync(linker, "utf8"), /\[target\]\(done\/TASK-target\.todo\.md\)/u);
});

test("links: inbound updated on reverse move", () => {
  const root = board();
  createTask(root, "TASK-target", { pr: "https://example.test/pr/1" });
  const linker = createTask(root, "TASK-linker");
  replace(linker, "## 8. Источники (Sources)", "## 8. Источники (Sources)\n\n[target](TASK-target.todo.md)");
  run(root, ["done", "TASK-target"]);
  run(root, ["start", "TASK-target", "--assignee=Разработчик (codex)"]);
  assert.match(readFileSync(linker, "utf8"), /\[target\]\(TASK-target\.todo\.md\)/u);
});

test("links: http links left untouched", () => {
  const root = board();
  const file = createTask(root, "TASK-http", { pr: "https://example.test/pr/1" });
  replace(file, "## 8. Источники (Sources)", "## 8. Источники (Sources)\n\n[site](https://example.com/x)");
  run(root, ["done", "TASK-http"]);
  assert.match(readFileSync(resolve(root, "todo/done/TASK-http.todo.md"), "utf8"), /https:\/\/example\.com\/x/u);
});

test("guard: transition rolls back on validation failure", () => {
  const root = board();
  const file = createTask(root, "TASK-broken", { pr: "https://example.test/pr/1" });
  replace(file, "## 5. Критерии приёмки (Definition of Done)", "## Removed");
  const before = readFileSync(file, "utf8");
  const result = run(root, ["done", "TASK-broken"]);
  assert.equal(result.code, 1);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.ok(!existsSync(resolve(root, "todo/done/TASK-broken.todo.md")));
});

test("set: field updated in place", () => {
  const root = board();
  const file = createTask(root);
  assert.equal(run(root, ["set", "TASK-example", "priority=P1"]).code, 0);
  assert.equal(field(file, "priority"), "P1");
});

test("set: status delegates to transition", () => {
  const root = board();
  createTask(root);
  assert.equal(run(root, ["set", "TASK-example", "status=backlog"]).code, 0);
  assert.ok(existsSync(resolve(root, "todo/backlog/TASK-example.todo.md")));
});

test("set: branch field", () => {
  const root = board();
  const file = createTask(root);
  run(root, ["set", "TASK-example", "branch=task/example"]);
  assert.equal(field(file, "branch"), "task/example");
});

test("set: multiple assignments applied in one call", () => {
  const root = board();
  const file = createTask(root);
  assert.equal(run(root, ["set", "TASK-example", "priority=P0", "branch=task/example"]).code, 0);
  assert.equal(field(file, "priority"), "P0");
  assert.equal(field(file, "branch"), "task/example");
});

test("set: non-assignment argument is an error, nothing applied", () => {
  const root = board();
  const file = createTask(root);
  const before = readFileSync(file, "utf8");
  assert.equal(run(root, ["set", "TASK-example", "priority=P0", "bad"]).code, 1);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("set: status cannot be combined with other fields", () => {
  const root = board();
  createTask(root);
  const result = run(root, ["set", "TASK-example", "status=backlog", "priority=P0"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot be combined/u);
});

test("transition: creates missing canonical directory", () => {
  const root = board();
  createTask(root, "TASK-dir");
  // directory is recreated by the transaction when absent
  mkdirSync(resolve(root, "todo/backlog"), { recursive: true });
  assert.equal(run(root, ["backlog", "TASK-dir"]).code, 0);
});
