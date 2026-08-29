import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach } from "node:test";
import { main, type CliIo } from "../src/cli.js";
import { findFileById } from "../src/parser.js";

const temporary = new Set<string>();

afterEach(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
  temporary.clear();
});

export function board(): string {
  const root = mkdtempSync(resolve(tmpdir(), "todo-md-ts-"));
  temporary.add(root);
  for (const directory of ["todo", "todo/backlog", "todo/done", "todo/cancelled"]) {
    mkdirSync(resolve(root, directory), { recursive: true });
  }
  return root;
}

export function run(root: string, args: string[], stdin = ""): { code: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    cwd: () => root,
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; },
    stdin: () => stdin,
  };
  const code = main(args, io);
  return { code, stdout, stderr };
}

export function createTask(root: string, id = "TASK-example", overrides: Record<string, string> = {}): string {
  const result = run(root, ["create", id, "--type=feat", "--author=Разработчик (codex)"]);
  if (result.code !== 0) throw new Error(result.stderr);
  const file = resolve(root, "todo", `${id}.todo.md`);
  if (Object.keys(overrides).length > 0) {
    const assignments = Object.entries(overrides).map(([key, value]) => `${key}=${value}`);
    const set = run(root, ["set", id, ...assignments]);
    if (set.code !== 0) throw new Error(set.stderr);
  }
  return findFileById(root, id) ?? file;
}

export function createEpic(root: string, id = "EPIC-example"): string {
  const result = run(root, ["create", id, "--author=Архитектор (codex)"]);
  if (result.code !== 0) throw new Error(result.stderr);
  return resolve(root, "todo", id, `${id}.todo.md`);
}

export function field(file: string, name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.*)$`, "m").exec(readFileSync(file, "utf8"));
  return match?.[1]?.trim() ?? null;
}

export function replace(file: string, from: string | RegExp, to: string): void {
  writeFileSync(file, readFileSync(file, "utf8").replace(from, to));
}
