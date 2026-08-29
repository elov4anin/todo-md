import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  LIFECYCLE_FIELD,
  STATUSES,
  TASK_TYPES,
  TodoMdError,
  type TaskStatus,
} from "./domain.js";
import {
  detectEol,
  detectKind,
  canonicalTodoPath,
  findFileById,
  findTodoFiles,
  makeRelativePath,
  normalizeMarkdownLinkTarget,
  parseFrontMatter,
  parseSimpleYaml,
  removeBom,
  shouldSkipLinkTarget,
} from "./parser.js";
import { checkOnBoard } from "./validator.js";
import { FileTransaction } from "./transaction.js";

export interface CreateOptions {
  type?: string;
  title?: string;
  value?: string;
  complexity?: string;
  priority?: string;
  author?: string;
  status?: string;
  epic?: string;
  depends_on?: string;
}

export function resolveRoot(cwd: string): string {
  let directory = resolve(cwd);
  while (true) {
    if (existsSync(resolve(directory, "todo"))) return realpathSync(directory);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new TodoMdError(`no todo/ directory found in or above: ${cwd}`);
}

export function nowTimestamp(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${local} (${Math.floor(now.getTime() / 1000)})`;
}

export function setFieldInContent(content: string, field: string, value: string): string {
  const hasBom = content.charCodeAt(0) === 0xfeff;
  const clean = removeBom(content);
  const eol = detectEol(clean);
  const lines = clean.split(/\r\n|\r|\n/);
  if (lines[0]?.trim() !== "---") return content;
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing === -1) return content;
  const pattern = new RegExp(`^${escapeRegExp(field)}:`);
  const found = lines.findIndex((line, index) => index > 0 && index < closing && pattern.test(line));
  if (found !== -1) lines[found] = `${field}: ${value}`;
  else lines.splice(closing, 0, `${field}: ${value}`);
  return `${hasBom ? "\ufeff" : ""}${lines.join(eol)}`;
}

export function getFieldFromContent(content: string, field: string): string | null {
  const parsed = parseFrontMatter(removeBom(content));
  if (parsed.error) return null;
  const value = parseSimpleYaml(parsed.frontMatter)[field];
  return value?.trim() ? value : null;
}

export function rewriteOutboundLinks(content: string, fromDir: string, toDir: string): string {
  if (resolve(fromDir) === resolve(toDir)) return content;
  return content.replace(/(!?)\[([^\]\n]*)]\(([^)\n]+)\)/g, (full, bang: string, text: string, raw: string) => {
    if (bang === "!") return full;
    const target = normalizeMarkdownLinkTarget(raw);
    if (!target || shouldSkipLinkTarget(target)) return full;
    const { path, suffix } = splitLinkTarget(target);
    if (path === "" || isAbsolute(path)) return full;
    const newRelative = toMarkdownPath(relative(toDir, resolve(fromDir, path)) || ".");
    return `[${text}](${newRelative}${suffix})`;
  });
}

export function computeInboundRewrites(root: string, oldFile: string, newFile: string): Map<string, string> {
  const changes = new Map<string, string>();
  const oldResolved = resolve(oldFile);
  for (const linker of findTodoFiles(root)) {
    if (resolve(linker) === oldResolved) continue;
    const content = readFileSync(linker, "utf8");
    const modified = content.replace(/(!?)\[([^\]\n]*)]\(([^)\n]+)\)/g,
      (full, bang: string, text: string, raw: string) => {
        if (bang === "!") return full;
        const target = normalizeMarkdownLinkTarget(raw);
        if (!target || shouldSkipLinkTarget(target)) return full;
        const { path, suffix } = splitLinkTarget(target);
        if (path === "" || isAbsolute(path) || resolve(dirname(linker), path) !== oldResolved) return full;
        return `[${text}](${toMarkdownPath(relative(dirname(linker), newFile))}${suffix})`;
      });
    if (modified !== content) changes.set(linker, modified);
  }
  return changes;
}

export function transition(
  root: string, id: string, newStatus: string, options: { assignee?: string } = {},
): string {
  if (!STATUSES.includes(newStatus as never)) throw new TodoMdError(`unknown status: ${newStatus}`);
  const file = findFileById(root, id);
  if (!file) throw new TodoMdError(`task not found: ${id}`);
  const content = readFileSync(file, "utf8");
  const metadata = parseMetadata(content);
  const kind = detectKind(id);
  if (!kind) throw new TodoMdError(`invalid task/epic ID: ${id}`);
  if (newStatus === "done" && !getFieldFromContent(content, "pr")?.trim()) {
    throw new TodoMdError(`field \`pr\` must be set before done — use: todo-md set ${id} pr=<url>`);
  }
  let next = setFieldInContent(content, "status", newStatus);
  const lifecycle = LIFECYCLE_FIELD[newStatus as TaskStatus];
  if (lifecycle) next = setFieldInContent(next, lifecycle, nowTimestamp());
  if (options.assignee !== undefined) next = setFieldInContent(next, "assignee", options.assignee);
  const newPath = safeCanonicalPath(root, newStatus, kind, id, metadata.epic ?? "");
  ensureMoveTargetAvailable(file, newPath);
  const newDirectory = dirname(newPath);
  const moved = resolve(file) !== newPath;
  if (moved) next = rewriteOutboundLinks(next, dirname(file), newDirectory);
  const inbound = moved ? computeInboundRewrites(root, file, newPath) : new Map<string, string>();
  const transaction = new FileTransaction();
  for (const [linker, rewritten] of inbound) transaction.write(linker, rewritten);
  transaction.write(newPath, next);
  if (moved) transaction.delete(file);
  transaction.commit();
  try {
    const result = checkOnBoard(root, newPath);
    if (result.errors.length > 0) {
      throw new TodoMdError(`validation failed after transition — rolled back:\n  ${result.errors.join("\n  ")}`);
    }
    const extra = result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : "";
    return `${statusVerb(newStatus)} ${id} → ${newStatus} (${makeRelativePath(newPath, root)})${extra}`;
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

export function create(root: string, id: string, options: CreateOptions = {}): string {
  const kind = detectKind(id);
  if (!kind || !/^(TASK|EPIC)-[a-z0-9][a-z0-9-]*$/u.test(id)) {
    throw new TodoMdError(`ID must start with TASK- or EPIC- and be kebab-case: ${id}`);
  }
  const existing = findFileById(root, id);
  if (existing) throw new TodoMdError(`already exists: ${id} (${makeRelativePath(existing, root)})`);
  const status = options.status ?? "todo";
  if (!STATUSES.includes(status as never)) throw new TodoMdError(`unknown status: ${status}`);
  const type = kind === "epic" ? "epic" : options.type;
  if (kind === "task" && (!type || !TASK_TYPES.includes(type as never))) {
    throw new TodoMdError(`--type is required for tasks, one of: ${TASK_TYPES.join(", ")}`);
  }
  const epic = options.epic ?? "";
  if (kind === "epic" && epic !== "") throw new TodoMdError("--epic can only be used with tasks");
  if (kind === "task" && epic !== "") assertExistingEpic(root, epic);
  const title = options.title ?? defaultTitle(id);
  const content = kind === "epic"
    ? renderEpicSkeleton(id, title, options)
    : renderTaskSkeleton(id, title, type ?? "", options, status);
  const newPath = safeCanonicalPath(root, status, kind, id, epic);
  const transaction = new FileTransaction();
  transaction.write(newPath, content);
  transaction.commit();
  try {
    const result = checkOnBoard(root, newPath);
    if (result.errors.length > 0) {
      throw new TodoMdError(`validation failed after create — file removed:\n  ${result.errors.join("\n  ")}`);
    }
  } catch (error) {
    transaction.rollback();
    throw error;
  }
  return `created ${id} (${makeRelativePath(newPath, root)})`;
}

export function setFields(root: string, id: string, fields: Record<string, string>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) throw new TodoMdError("no fields to set");
  if ("status" in fields) {
    if (entries.length !== 1) {
      throw new TodoMdError(`\`status\` cannot be combined with other fields — set it alone: set ${id} status=<value>`);
    }
    return transition(root, id, fields.status ?? "");
  }
  const file = findFileById(root, id);
  if (!file) throw new TodoMdError(`task not found: ${id}`);
  const content = readFileSync(file, "utf8");
  const kind = detectKind(id);
  if (!kind) throw new TodoMdError(`invalid task/epic ID: ${id}`);
  if ("epic" in fields) {
    if (kind !== "task") throw new TodoMdError("field `epic` can only be set on tasks");
    if ((fields.epic ?? "") !== "") assertExistingEpic(root, fields.epic ?? "");
  }
  let next = content;
  for (const [field, value] of entries) {
    const updated = setFieldInContent(next, field, value);
    if (updated === next) throw new TodoMdError(`could not set field (no front matter?): ${field}`);
    next = updated;
  }
  const metadata = parseMetadata(next);
  const newPath = safeCanonicalPath(root, metadata.status ?? "", kind, id, metadata.epic ?? "");
  ensureMoveTargetAvailable(file, newPath);
  const moved = resolve(file) !== resolve(newPath);
  if (moved) next = rewriteOutboundLinks(next, dirname(file), dirname(newPath));
  const inbound = moved ? computeInboundRewrites(root, file, newPath) : new Map<string, string>();
  const transaction = new FileTransaction();
  for (const [linker, rewritten] of inbound) transaction.write(linker, rewritten);
  transaction.write(newPath, next);
  if (moved) transaction.delete(file);
  transaction.commit();
  try {
    const result = checkOnBoard(root, newPath);
    if (result.errors.length > 0) {
      throw new TodoMdError(`validation failed after set — rolled back:\n  ${result.errors.join("\n  ")}`);
    }
  } catch (error) {
    transaction.rollback();
    throw error;
  }
  const applied = entries.map(([field, value]) => `${field} = ${value}`).join(", ");
  return entries.length === 1
    ? `set ${id}.${entries[0]?.[0]} = ${entries[0]?.[1]} (${makeRelativePath(newPath, root)})`
    : `set ${id}: ${applied} (${makeRelativePath(newPath, root)})`;
}

function parseMetadata(content: string): Record<string, string> {
  const parsed = parseFrontMatter(removeBom(content));
  if (parsed.error) throw new TodoMdError(`could not read front matter: ${parsed.error}`);
  return parseSimpleYaml(parsed.frontMatter);
}

function safeCanonicalPath(
  root: string, status: string, kind: "task" | "epic", id: string, epic: string,
): string {
  try {
    return canonicalTodoPath(root, status, kind, id, epic);
  } catch (error) {
    throw new TodoMdError(error instanceof Error ? error.message : String(error));
  }
}

function assertExistingEpic(root: string, epic: string): void {
  if (!/^EPIC-[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(epic)) throw new TodoMdError(`unsafe epic ID: ${epic}`);
  const file = findFileById(root, epic);
  if (!file) throw new TodoMdError(`epic not found: ${epic}`);
  const metadata = parseMetadata(readFileSync(file, "utf8"));
  if (metadata.type !== "epic") throw new TodoMdError(`referenced ID is not an epic: ${epic}`);
}

function ensureMoveTargetAvailable(source: string, target: string): void {
  if (resolve(source) !== resolve(target) && existsSync(target)) {
    throw new TodoMdError(`canonical path already exists: ${target}`);
  }
}

function renderTaskSkeleton(id: string, title: string, type: string, options: CreateOptions, status: string): string {
  const author = options.author ?? "Исполнитель (pi)";
  const now = nowTimestamp();
  const fm: Record<string, string> = {
    type, created: now, due: "", started: "", completed: "", cancelled: "",
    value: options.value ?? "V2", complexity: options.complexity ?? "C2", priority: options.priority ?? "P2",
    cost_plan: "", cost_fact: "", depends_on: options.depends_on ?? "", epic: options.epic ?? "",
    author, assignee: "", branch: "", pr: "", status,
  };
  return renderDocument(fm, [
    `# ${id}: ${title}`, "", "## 0. Простое описание (Human Brief)", "",
    "### Проблема простыми словами (Problem)", "- (заполнить)", "",
    "### Варианты или путь решения (Solution Sketch)", "- (заполнить)", "",
    "### Ожидаемый результат (Expected Result)", "- (заполнить)", "",
    "## 1. Концепция и Цель (Concept and Goal)", "", "### История (User Story)", "> (заполнить)", "",
    "### Цель по SMART (Goal)", "- (заполнить)", "", "## 2. Контекст и Границы (Context and Scope)", "",
    "## 3. Требования, MoSCoW (Requirements)", "### 🔴 Обязательно (Must Have)", "- [ ] (заполнить)",
    "### ⚫ Won't Have (Не будем делать)", "- (заполнить)", "", "## 4. План реализации (Implementation Plan)",
    "1. [ ] (заполнить)", "", "## 5. Критерии приёмки (Definition of Done)", "- [ ] (заполнить)", "",
    "## 6. Самопроверка (Verification)", "```bash", "npx todo-md validate", "```", "",
    "## 7. Риски и зависимости (Risks and Dependencies)", "- (заполнить)", "", "## 8. Источники (Sources)", "",
    "## 9. Комментарии (Comments)", "", "## История изменений (Change History)",
    "| Дата | Автор (роль) | Изменение |", "| :--- | :--- | :--- |", `| ${now} | ${author} | Создание задачи |`, "",
  ]);
}

function renderEpicSkeleton(id: string, title: string, options: CreateOptions): string {
  const author = options.author ?? "Исполнитель (pi)";
  const now = nowTimestamp();
  const fm: Record<string, string> = {
    type: "epic", created: now, due: "", started: "", completed: "", cancelled: "",
    value: options.value ?? "V2", complexity: options.complexity ?? "C2", priority: options.priority ?? "P2",
    cost_plan: "", cost_fact: "", author, assignee: "", status: options.status ?? "todo", pr: "",
  };
  return renderDocument(fm, [
    `# ${id}: ${title}`, "", "## 0. Простое описание (Human Brief)", "",
    "### Проблема простыми словами (Problem)", "- (заполнить)", "",
    "### Варианты или путь решения (Solution Sketch)", "- (заполнить)", "",
    "### Ожидаемый результат (Expected Result)", "- (заполнить)", "",
    "## 1. Концепция и цель (Concept and Goal)", "", "## 2. Контекст и границы (Context and Scope)", "",
    "## 3. Требования, MoSCoW (Requirements)", "### 🔴 Блокирующие требования (Must Have)", "- [ ] (заполнить)",
    "### ⚫ Won't Have (Не в этот раз)", "- (заполнить)", "", "## 4. Техническое решение (Solution Design)", "",
    "## 5. План реализации (Implementation Plan)", "", "## 6. Критерии приёмки эпика (Definition of Done)",
    "- [ ] (заполнить)", "", "## История изменений (Change History)", "| Дата | Автор (роль) | Изменение |",
    "| :--- | :--- | :--- |", `| ${now} | ${author} | Создание эпика |`, "",
  ]);
}

function renderDocument(frontMatter: Record<string, string>, body: string[]): string {
  return ["---", ...Object.entries(frontMatter).map(([key, value]) => `${key}: ${value}`), "---", "", ...body].join("\n");
}

function defaultTitle(id: string): string {
  return id.replace(/^(TASK|EPIC)-/u, "").split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function splitLinkTarget(target: string): { path: string; suffix: string } {
  const positions = [target.indexOf("#"), target.indexOf("?")].filter((position) => position >= 0);
  const cut = positions.length > 0 ? Math.min(...positions) : -1;
  return cut === -1 ? { path: target, suffix: "" } : { path: target.slice(0, cut), suffix: target.slice(cut) };
}

function statusVerb(status: string): string {
  if (status === "todo" || status === "in_progress") return "started";
  if (status === "review" || status === "backlog") return "moved";
  if (status === "done") return "completed";
  if (status === "cancelled") return "cancelled";
  return "transitioned";
}

function toMarkdownPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
