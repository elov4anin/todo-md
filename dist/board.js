import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { LIFECYCLE_FIELD, STATUSES, TASK_TYPES, TodoMdError, } from "./domain.js";
import { detectEol, detectKind, findFileById, findTodoFiles, folderForStatus, makeRelativePath, normalizeMarkdownLinkTarget, parseFrontMatter, parseSimpleYaml, removeBom, shouldSkipLinkTarget, } from "./parser.js";
import { checkOnBoard } from "./validator.js";
import { FileTransaction } from "./transaction.js";
export function resolveRoot(cwd) {
    let directory = resolve(cwd);
    while (true) {
        if (existsSync(resolve(directory, "todo")))
            return realpathSync(directory);
        const parent = dirname(directory);
        if (parent === directory)
            break;
        directory = parent;
    }
    throw new TodoMdError(`no todo/ directory found in or above: ${cwd}`);
}
export function nowTimestamp(now = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return `${local} (${Math.floor(now.getTime() / 1000)})`;
}
export function setFieldInContent(content, field, value) {
    const hasBom = content.charCodeAt(0) === 0xfeff;
    const clean = removeBom(content);
    const eol = detectEol(clean);
    const lines = clean.split(/\r\n|\r|\n/);
    if (lines[0]?.trim() !== "---")
        return content;
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing === -1)
        return content;
    const pattern = new RegExp(`^${escapeRegExp(field)}:`);
    const found = lines.findIndex((line, index) => index > 0 && index < closing && pattern.test(line));
    if (found !== -1)
        lines[found] = `${field}: ${value}`;
    else
        lines.splice(closing, 0, `${field}: ${value}`);
    return `${hasBom ? "\ufeff" : ""}${lines.join(eol)}`;
}
export function getFieldFromContent(content, field) {
    const parsed = parseFrontMatter(removeBom(content));
    if (parsed.error)
        return null;
    const value = parseSimpleYaml(parsed.frontMatter)[field];
    return value?.trim() ? value : null;
}
export function rewriteOutboundLinks(content, fromDir, toDir) {
    if (resolve(fromDir) === resolve(toDir))
        return content;
    return content.replace(/(!?)\[([^\]\n]*)]\(([^)\n]+)\)/g, (full, bang, text, raw) => {
        if (bang === "!")
            return full;
        const target = normalizeMarkdownLinkTarget(raw);
        if (!target || shouldSkipLinkTarget(target))
            return full;
        const { path, suffix } = splitLinkTarget(target);
        if (path === "" || isAbsolute(path))
            return full;
        const newRelative = toMarkdownPath(relative(toDir, resolve(fromDir, path)) || ".");
        return `[${text}](${newRelative}${suffix})`;
    });
}
export function computeInboundRewrites(root, oldFile, newFile) {
    const changes = new Map();
    const oldResolved = resolve(oldFile);
    for (const linker of findTodoFiles(root)) {
        if (resolve(linker) === oldResolved)
            continue;
        const content = readFileSync(linker, "utf8");
        const modified = content.replace(/(!?)\[([^\]\n]*)]\(([^)\n]+)\)/g, (full, bang, text, raw) => {
            if (bang === "!")
                return full;
            const target = normalizeMarkdownLinkTarget(raw);
            if (!target || shouldSkipLinkTarget(target))
                return full;
            const { path, suffix } = splitLinkTarget(target);
            if (path === "" || isAbsolute(path) || resolve(dirname(linker), path) !== oldResolved)
                return full;
            return `[${text}](${toMarkdownPath(relative(dirname(linker), newFile))}${suffix})`;
        });
        if (modified !== content)
            changes.set(linker, modified);
    }
    return changes;
}
export function transition(root, id, newStatus, options = {}) {
    if (!STATUSES.includes(newStatus))
        throw new TodoMdError(`unknown status: ${newStatus}`);
    const file = findFileById(root, id);
    if (!file)
        throw new TodoMdError(`task not found: ${id}`);
    const content = readFileSync(file, "utf8");
    if (newStatus === "done" && !getFieldFromContent(content, "pr")?.trim()) {
        throw new TodoMdError(`field \`pr\` must be set before done — use: todo-md set ${id} pr=<url>`);
    }
    let next = setFieldInContent(content, "status", newStatus);
    const lifecycle = LIFECYCLE_FIELD[newStatus];
    if (lifecycle)
        next = setFieldInContent(next, lifecycle, nowTimestamp());
    if (options.assignee !== undefined)
        next = setFieldInContent(next, "assignee", options.assignee);
    const subfolder = folderForStatus(newStatus);
    const newDirectory = subfolder === "" ? resolve(root, "todo") : resolve(root, "todo", subfolder);
    const newPath = resolve(newDirectory, basename(file));
    const moved = resolve(file) !== newPath;
    if (moved)
        next = rewriteOutboundLinks(next, dirname(file), newDirectory);
    const inbound = moved ? computeInboundRewrites(root, file, newPath) : new Map();
    const transaction = new FileTransaction();
    for (const [linker, rewritten] of inbound)
        transaction.write(linker, rewritten);
    transaction.write(newPath, next);
    if (moved)
        transaction.delete(file);
    transaction.commit();
    try {
        const result = checkOnBoard(root, newPath);
        if (result.errors.length > 0) {
            throw new TodoMdError(`validation failed after transition — rolled back:\n  ${result.errors.join("\n  ")}`);
        }
        const extra = result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : "";
        return `${statusVerb(newStatus)} ${id} → ${newStatus} (${makeRelativePath(newPath, root)})${extra}`;
    }
    catch (error) {
        transaction.rollback();
        throw error;
    }
}
export function create(root, id, options = {}) {
    const kind = detectKind(id);
    if (!kind || !/^(TASK|EPIC)-[a-z0-9][a-z0-9-]*$/u.test(id)) {
        throw new TodoMdError(`ID must start with TASK- or EPIC- and be kebab-case: ${id}`);
    }
    const existing = findFileById(root, id);
    if (existing)
        throw new TodoMdError(`already exists: ${id} (${makeRelativePath(existing, root)})`);
    const status = options.status ?? "todo";
    if (!STATUSES.includes(status))
        throw new TodoMdError(`unknown status: ${status}`);
    const type = kind === "epic" ? "epic" : options.type;
    if (kind === "task" && (!type || !TASK_TYPES.includes(type))) {
        throw new TodoMdError(`--type is required for tasks, one of: ${TASK_TYPES.join(", ")}`);
    }
    const title = options.title ?? defaultTitle(id);
    const content = kind === "epic"
        ? renderEpicSkeleton(id, title, options)
        : renderTaskSkeleton(id, title, type ?? "", options, status);
    const folder = folderForStatus(status);
    const newPath = resolve(root, "todo", folder, `${id}.todo.md`);
    const transaction = new FileTransaction();
    transaction.write(newPath, content);
    transaction.commit();
    try {
        const result = checkOnBoard(root, newPath);
        if (result.errors.length > 0) {
            throw new TodoMdError(`validation failed after create — file removed:\n  ${result.errors.join("\n  ")}`);
        }
    }
    catch (error) {
        transaction.rollback();
        throw error;
    }
    return `created ${id} (${makeRelativePath(newPath, root)})`;
}
export function setFields(root, id, fields) {
    const entries = Object.entries(fields);
    if (entries.length === 0)
        throw new TodoMdError("no fields to set");
    if ("status" in fields) {
        if (entries.length !== 1) {
            throw new TodoMdError(`\`status\` cannot be combined with other fields — set it alone: set ${id} status=<value>`);
        }
        return transition(root, id, fields.status ?? "");
    }
    const file = findFileById(root, id);
    if (!file)
        throw new TodoMdError(`task not found: ${id}`);
    const content = readFileSync(file, "utf8");
    let next = content;
    for (const [field, value] of entries) {
        const updated = setFieldInContent(next, field, value);
        if (updated === next)
            throw new TodoMdError(`could not set field (no front matter?): ${field}`);
        next = updated;
    }
    const transaction = new FileTransaction();
    transaction.write(file, next);
    transaction.commit();
    try {
        const result = checkOnBoard(root, file);
        if (result.errors.length > 0) {
            throw new TodoMdError(`validation failed after set — rolled back:\n  ${result.errors.join("\n  ")}`);
        }
    }
    catch (error) {
        transaction.rollback();
        throw error;
    }
    const applied = entries.map(([field, value]) => `${field} = ${value}`).join(", ");
    return entries.length === 1
        ? `set ${id}.${entries[0]?.[0]} = ${entries[0]?.[1]} (${makeRelativePath(file, root)})`
        : `set ${id}: ${applied} (${makeRelativePath(file, root)})`;
}
function renderTaskSkeleton(id, title, type, options, status) {
    const author = options.author ?? "Исполнитель (pi)";
    const now = nowTimestamp();
    const fm = {
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
function renderEpicSkeleton(id, title, options) {
    const author = options.author ?? "Исполнитель (pi)";
    const now = nowTimestamp();
    const fm = {
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
function renderDocument(frontMatter, body) {
    return ["---", ...Object.entries(frontMatter).map(([key, value]) => `${key}: ${value}`), "---", "", ...body].join("\n");
}
function defaultTitle(id) {
    return id.replace(/^(TASK|EPIC)-/u, "").split("-")
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}
function splitLinkTarget(target) {
    const positions = [target.indexOf("#"), target.indexOf("?")].filter((position) => position >= 0);
    const cut = positions.length > 0 ? Math.min(...positions) : -1;
    return cut === -1 ? { path: target, suffix: "" } : { path: target.slice(0, cut), suffix: target.slice(cut) };
}
function statusVerb(status) {
    if (status === "todo" || status === "in_progress")
        return "started";
    if (status === "review" || status === "backlog")
        return "moved";
    if (status === "done")
        return "completed";
    if (status === "cancelled")
        return "cancelled";
    return "transitioned";
}
function toMarkdownPath(path) {
    return path.replaceAll("\\", "/");
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
//# sourceMappingURL=board.js.map