import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { board, createEpic, createTask, run } from "./support.js";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

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
  const title = `Задачи — ${basename(root)}`;
  assert.ok(result.stdout.includes(`<title>${title}</title>`));
  assert.ok(result.stdout.includes(`<h1>${title}</h1>`));
  assert.match(result.stdout, /TASK-example/u);
  assert.doesNotMatch(result.stdout, /cdn\.jsdelivr/u);
  assert.match(result.stdout, /Chart\.js/u);
});

test("dashboard: uses the project directory in the default title for every input mode", () => {
  const root = board();
  createTask(root);
  const input = resolve(root, "tasks.jsonl");
  const jsonl = `${JSON.stringify({ id: "TASK-title", kind: "TASK", title: "title", file: "todo/TASK-title.todo.md", folder: "active", status: "todo" })}\n`;
  writeFileSync(input, jsonl);
  const expected = `<title>Задачи — ${basename(root)}</title>`;

  for (const result of [
    run(root, ["dashboard"]),
    run(root, ["dashboard", input]),
    run(root, ["dashboard", "-"], jsonl),
  ]) {
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes(expected));
  }
});

test("dashboard: escapes the project directory name in the default title", () => {
  const parent = board();
  const root = resolve(parent, `project & <demo> "'`);
  for (const directory of ["todo", "todo/backlog", "todo/done", "todo/cancelled"]) {
    mkdirSync(resolve(root, directory), { recursive: true });
  }
  createTask(root);

  const result = run(root, ["dashboard"]);
  assert.equal(result.code, 0);
  const escaped = "Задачи — project &amp; &lt;demo&gt; &quot;&#039;";
  assert.ok(result.stdout.includes(`<title>${escaped}</title>`));
  assert.ok(result.stdout.includes(`<h1>${escaped}</h1>`));
});

test("dashboard: explicit title replaces the default title", () => {
  const root = board();
  createTask(root);
  const result = run(root, ["dashboard", "--title=Мой & <обзор>"]);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes("<title>Мой &amp; &lt;обзор&gt;</title>"));
  assert.ok(result.stdout.includes("<h1>Мой &amp; &lt;обзор&gt;</h1>"));
  assert.ok(!result.stdout.includes(`<title>Задачи — ${basename(root)}</title>`));
});

test("dashboard: recursively renders a task from an epic directory", () => {
  const root = board();
  createEpic(root, "EPIC-parent");
  assert.equal(run(root, ["create", "TASK-child", "--type=feat", "--author=Разработчик (codex)", "--epic=EPIC-parent"]).code, 0);
  const result = run(root, ["dashboard"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /TASK-child/u);
  assert.match(result.stdout, /todo\/EPIC-parent\/TASK-child\.todo\.md/u);
});

test("dashboard: directory mode links nested epic files across all zones without --base", () => {
  const root = board();
  createEpic(root, "EPIC-parent");
  for (const id of ["TASK-active", "TASK-back", "TASK-fin", "TASK-canc"]) {
    const created = run(root, ["create", id, "--type=feat", "--author=Разработчик (codex)", "--epic=EPIC-parent", "--status=backlog"]);
    assert.equal(created.code, 0, created.stderr);
  }
  assert.equal(run(root, ["start", "TASK-active", "--assignee=Разработчик (codex)"]).code, 0);
  assert.equal(run(root, ["set", "TASK-fin", "pr=https://example.test/pr/1"]).code, 0);
  assert.equal(run(root, ["done", "TASK-fin", "--assignee=Разработчик (codex)"]).code, 0);
  assert.equal(run(root, ["cancel", "TASK-canc"]).code, 0);
  const result = run(root, ["dashboard"]);
  assert.equal(result.code, 0);
  const expected: Record<string, string> = {
    "EPIC-parent": "todo/EPIC-parent/EPIC-parent.todo.md",
    "TASK-active": "todo/EPIC-parent/TASK-active.todo.md",
    "TASK-back": "todo/backlog/EPIC-parent/TASK-back.todo.md",
    "TASK-fin": "todo/done/EPIC-parent/TASK-fin.todo.md",
    "TASK-canc": "todo/cancelled/EPIC-parent/TASK-canc.todo.md",
  };
  for (const [id, file] of Object.entries(expected)) {
    assert.equal(occurrences(result.stdout, `"id": "${id}"`), 1, `${id} must appear exactly once`);
    assert.equal(occurrences(result.stdout, `"url": ${JSON.stringify(pathToFileURL(resolve(root, file)).href)}`), 1, `${id} must link its actual file`);
  }
  // data that feeds task-card (ct-link) and epic-header (col-link) anchors
  assert.ok(result.stdout.includes('"folder": "done"'));
  assert.ok(result.stdout.includes('"folder": "cancelled"'));
  assert.ok(result.stdout.includes('"folder": "backlog"'));
  assert.ok(result.stdout.includes("ct-link") && result.stdout.includes("col-link"));
});

test("dashboard: JSONL with --base resolves relative nested paths", () => {
  const root = board();
  const jsonl = `${JSON.stringify({ id: "TASK-nested", kind: "TASK", title: "nested", file: "todo/EPIC-x/TASK-nested.todo.md", folder: "active", status: "todo" })}\n`;
  const result = run(root, ["dashboard", "-", `--base=${root}`], jsonl);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes(`"url": ${JSON.stringify(pathToFileURL(resolve(root, "todo/EPIC-x/TASK-nested.todo.md")).href)}`));
});

test("dashboard: JSONL without --base keeps no invented base and drops a malicious url", () => {
  const root = board();
  const jsonl = `${JSON.stringify({ id: "TASK-evil", kind: "TASK", title: "evil", file: "todo/EPIC-x/TASK-evil.todo.md", folder: "active", status: "todo", url: 'javascript:alert(1)" onmouseover="alert(2)' })}\n`;
  const result = run(root, ["dashboard", "-"], jsonl);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('"id": "TASK-evil"'));
  assert.ok(!result.stdout.includes('"url":'));
  assert.ok(!result.stdout.includes("javascript:"));
  assert.ok(!result.stdout.includes("onmouseover="));
});

test("dashboard: JSONL with --base re-derives url from file instead of trusting input", () => {
  const root = board();
  const jsonl = `${JSON.stringify({ id: "TASK-evil2", kind: "TASK", title: "evil2", file: "todo/EPIC-x/TASK-evil2.todo.md", folder: "active", status: "todo", url: "javascript:alert(1)" })}\n`;
  const result = run(root, ["dashboard", "-", `--base=${root}`], jsonl);
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes(`"url": ${JSON.stringify(pathToFileURL(resolve(root, "todo/EPIC-x/TASK-evil2.todo.md")).href)}`));
  assert.ok(!result.stdout.includes("javascript:"));
});

test("dashboard: encodes spaces and non-ASCII segments of nested file paths", () => {
  const root = board();
  const epicDir = resolve(root, "todo/EPIC-spëcial");
  mkdirSync(epicDir, { recursive: true });
  writeFileSync(resolve(epicDir, "TASK-sp ace.todo.md"), "---\nstatus: todo\n---\n# TASK-sp ace\n");
  const result = run(root, ["dashboard"]);
  assert.equal(result.code, 0);
  const url = pathToFileURL(resolve(root, "todo/EPIC-spëcial/TASK-sp ace.todo.md")).href;
  assert.ok(url.includes("%20") && url.includes("%C3%AB"));
  assert.ok(result.stdout.includes(`"url": ${JSON.stringify(url)}`));
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
