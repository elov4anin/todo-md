import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { board, createTask, run } from "./support.js";

test("init: scaffolds JSON config", () => {
  const root = board();
  const result = run(root, ["init"]);
  assert.equal(result.code, 0);
  const config = JSON.parse(readFileSync(resolve(root, ".todo-md.json"), "utf8")) as Record<string, unknown>;
  assert.equal(config.strict, false);
  assert.ok(Array.isArray(config.agents));
});

test("init: copies docs and AGENTS.md", () => {
  const root = board();
  assert.equal(run(root, ["init"]).code, 0);
  assert.ok(existsSync(resolve(root, "docs/todo-md/AGENTS_TASK_WRITING_GUIDE.md")));
  assert.ok(existsSync(resolve(root, "todo/AGENTS.md")));
});

test("init: is idempotent without force", () => {
  const root = board();
  run(root, ["init"]);
  writeFileSync(resolve(root, ".todo-md.json"), "{}\n");
  const result = run(root, ["init"]);
  assert.equal(result.code, 0);
  assert.equal(readFileSync(resolve(root, ".todo-md.json"), "utf8"), "{}\n");
  assert.match(result.stdout, /Skip.*\.todo-md\.json/u);
});

test("init: force refreshes generated config", () => {
  const root = board();
  run(root, ["init"]);
  writeFileSync(resolve(root, ".todo-md.json"), "{}\n");
  assert.equal(run(root, ["init", "--force"]).code, 0);
  assert.match(readFileSync(resolve(root, ".todo-md.json"), "utf8"), /"strict": false/u);
});

test("init: rejects path traversal", () => {
  const result = run(board(), ["init", "--docs-path=../outside"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must stay inside/u);
});

test("dashboard: renders tasks and embeds Chart.js", () => {
  const root = board();
  createTask(root);
  const result = run(root, ["dashboard"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /TASK-example/u);
  assert.doesNotMatch(result.stdout, /cdn\.jsdelivr/u);
  assert.match(result.stdout, /Chart\.js/u);
});

test("dashboard: accepts JSONL stdin", () => {
  const root = board();
  const jsonl = `${JSON.stringify({ id: "TASK-stdin", kind: "TASK", title: "stdin", file: "todo/TASK-stdin.todo.md", folder: "active", status: "todo" })}\n`;
  const result = run(root, ["dashboard", "-"], jsonl);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /TASK-stdin/u);
});

test("dashboard: writes output and escapes script terminators", () => {
  const root = board();
  const input = resolve(root, "input.jsonl");
  const output = resolve(root, "dashboard.html");
  writeFileSync(input, `${JSON.stringify({ id: "TASK-x", kind: "TASK", title: "</script><script>alert(1)</script>", file: "x", folder: "active", status: "todo" })}\n`);
  const result = run(root, ["dashboard", input, "-o", output]);
  assert.equal(result.code, 0);
  assert.ok(existsSync(output));
  assert.doesNotMatch(readFileSync(output, "utf8"), /const TASKS = .*<\/script><script>/u);
});
