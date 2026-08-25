import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TodoMdError } from "./domain.js";

export interface InitOptions {
  force?: boolean;
  docsPath?: string;
  agentsPath?: string;
}

export interface InitResult {
  lines: string[];
  copied: number;
  updated: number;
  skipped: number;
}

export function initProject(target: string, options: InitOptions = {}): InitResult {
  const targetDir = resolve(target);
  if (!existsSync(targetDir)) throw new TodoMdError(`target directory does not exist: ${target}`);
  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  const docsPath = safeRelative(options.docsPath ?? "docs/todo-md", "--docs-path");
  const agentsPath = safeRelative(options.agentsPath ?? "todo/AGENTS.md", "--agents-path");
  const sourceDocs = resolve(packageRoot, "docs/todo-md");
  const agentsSource = resolve(packageRoot, "assets/init/AGENTS.md");
  if (!existsSync(sourceDocs)) throw new TodoMdError(`package docs/ not found at ${sourceDocs}`);
  const result: InitResult = { lines: [], copied: 0, updated: 0, skipped: 0 };
  if (options.force) result.lines.push("  ⚠  --force: existing files will be overwritten.");

  for (const directory of ["todo", "todo/backlog", "todo/done", "todo/cancelled"]) {
    const absolute = resolve(targetDir, directory);
    if (!existsSync(absolute)) {
      mkdirSync(absolute, { recursive: true });
      result.lines.push(`  Created  ${absolute}/`);
    } else result.lines.push(`  Exists   ${absolute}/`);
    const gitkeep = resolve(absolute, ".gitkeep");
    if (!existsSync(gitkeep)) writeFileSync(gitkeep, "");
  }

  copyTree(sourceDocs, resolve(targetDir, docsPath), docsPath, options.force === true, result);
  copyOne(agentsSource, resolve(targetDir, agentsPath), agentsPath, options.force === true, result);
  const config = `${JSON.stringify({
    $schema: "./node_modules/@elov4anin/todo-md/schemas/config.schema.json",
    roles: [],
    agents: ["gemini-cli", "codex-cli", "codex", "opencode", "roocode", "kilocode", "pi"],
    strict: false,
  }, null, 2)}\n`;
  writeGenerated(resolve(targetDir, ".todo-md.json"), config, ".todo-md.json", options.force === true, result);
  updateGitignore(resolve(targetDir, "docs/.gitignore"), `${dirname(docsPath) === "docs" ? docsPath.split("/").at(-1) : docsPath}/`, result);
  updateGitignore(resolve(targetDir, dirname(agentsPath), ".gitignore"), agentsPath.split("/").at(-1) ?? "AGENTS.md", result);
  result.lines.push("", `Done. ${result.copied} copied, ${result.updated} updated, ${result.skipped} skipped.`, "",
    "Next steps:", `  1. Add this line to your project's AGENTS.md:`,
    `     * Регламент работы с задачами: [\`${agentsPath}\`](${agentsPath}).`,
    "  2. Create tasks: npx todo-md create TASK-<category>-<name> --type=<type> --author=\"<роль> (<агент>)\"",
    "  3. Validate tasks: npx todo-md validate");
  return result;
}

function findPackageRoot(start: string): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(resolve(directory, "package.json")) && existsSync(resolve(directory, "docs/todo-md"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new TodoMdError(`cannot locate todo-md package assets from ${start}`);
}

function safeRelative(value: string, option: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (isAbsolute(value) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new TodoMdError(`${option} must stay inside the target project: ${value}`);
  }
  return normalized;
}

function copyTree(source: string, destination: string, displayRoot: string, force: boolean, result: InitResult): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = resolve(source, entry.name);
    const to = resolve(destination, entry.name);
    const display = `${displayRoot}/${entry.name}`;
    if (entry.isDirectory()) copyTree(from, to, display, force, result);
    else if (entry.isFile()) copyOne(from, to, display, force, result);
  }
}

function copyOne(source: string, destination: string, display: string, force: boolean, result: InitResult): void {
  mkdirSync(dirname(destination), { recursive: true });
  const existed = existsSync(destination);
  if (existed && !force) {
    result.lines.push(`  Skip     ${display} (already exists)`);
    result.skipped += 1;
    return;
  }
  copyFileSync(source, destination);
  if (existed) {
    result.lines.push(`  Updated  ${display}`);
    result.updated += 1;
  } else {
    result.lines.push(`  Copied   ${display}`);
    result.copied += 1;
  }
}

function writeGenerated(destination: string, content: string, display: string, force: boolean, result: InitResult): void {
  const existed = existsSync(destination);
  if (existed && !force) {
    result.lines.push(`  Skip     ${display} (already exists)`);
    result.skipped += 1;
    return;
  }
  writeFileSync(destination, content);
  result.lines.push(`  ${existed ? "Updated" : "Copied "}  ${display}`);
  if (existed) result.updated += 1; else result.copied += 1;
}

function updateGitignore(file: string, entry: string, result: InitResult): void {
  mkdirSync(dirname(file), { recursive: true });
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (content.split(/\r?\n/u).includes(entry)) return;
  writeFileSync(file, `${content.trimEnd()}${content.trim() ? "\n" : ""}${entry}\n`);
  result.lines.push(`  Updated ${relative(dirname(dirname(file)), file)} (+ ${entry})`);
}
