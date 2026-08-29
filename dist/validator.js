import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { ACTIVE_STATUSES, AI_AGENTS, COMPLEXITIES, PRIORITIES, STATUSES, TASK_TYPES, VALUES, } from "./domain.js";
import { loadConfig } from "./config.js";
import { buildIdIndex, canonicalTodoPath, detectKind, extractMarkdownLinks, fileId, findTodoFiles, parseFrontMatter, parseSimpleYaml, removeBom, stripLinkFragmentAndQuery, } from "./parser.js";
const ASSIGNEE_REQUIRED_STATUSES = ["in_progress", "paused", "blocked", "review", "done"];
const DEFAULT_VALIDATION_CONFIG = { roles: [], agents: [], strict: false };
export function validateFile(file, idIndex, config = DEFAULT_VALIDATION_CONFIG) {
    const errors = [];
    const warnings = [];
    let content;
    try {
        content = removeBom(readFileSync(file, "utf8"));
    }
    catch {
        return { errors: ["cannot read file"], warnings: [] };
    }
    const parsed = parseFrontMatter(content);
    if (parsed.error)
        return { errors: [parsed.error], warnings: [] };
    const frontMatter = parseSimpleYaml(parsed.frontMatter, warnings);
    const id = fileId(file);
    const kind = detectKind(id);
    if (!kind)
        errors.push("file name must start with TASK- or EPIC- and end with .todo.md");
    validateFrontMatter(frontMatter, kind, errors, warnings, config);
    validateDependencies(frontMatter, idIndex, errors, warnings);
    validateTitle(parsed.body, id, errors);
    validateSections(parsed.body, kind, errors);
    validateChangeHistory(parsed.body, errors);
    validateFolderStatus(file, frontMatter.status ?? "", errors);
    validateDirectoryLayout(file, id, kind, frontMatter, errors, warnings);
    validateMarkdownLinks(file, parsed.body, errors);
    validateNoTemplatePlaceholders(content, errors);
    return { errors, warnings };
}
export function checkOnBoard(root, file) {
    const files = findTodoFiles(root);
    return validateFile(file, buildIdIndex(files), loadConfig(root));
}
function validateFrontMatter(frontMatter, kind, errors, warnings, config) {
    const required = ["type", "created", "value", "complexity", "priority", "author", "assignee", "status"];
    if (kind === "task")
        required.push("depends_on", "epic", "branch", "pr");
    else if (kind === "epic")
        required.push("pr");
    for (const key of required) {
        if (!(key in frontMatter))
            errors.push(`missing front matter field \`${key}\``);
    }
    const type = frontMatter.type ?? "";
    if (kind === "epic" && type !== "epic")
        errors.push("EPIC file must have `type: epic`");
    else if (kind === "task" && !TASK_TYPES.includes(type)) {
        errors.push(`\`type\` must be one of: ${TASK_TYPES.join(", ")}`);
    }
    validateDate("created", frontMatter.created ?? "", errors);
    validateEnum("value", frontMatter.value ?? "", VALUES, errors);
    validateEnum("complexity", frontMatter.complexity ?? "", COMPLEXITIES, errors);
    validateEnum("priority", frontMatter.priority ?? "", PRIORITIES, errors);
    validateEnum("status", frontMatter.status ?? "", STATUSES, errors);
    validateOptionalInteger("cost_plan", frontMatter.cost_plan ?? "", errors);
    validateOptionalInteger("cost_fact", frontMatter.cost_fact ?? "", errors);
    for (const field of ["due", "started", "completed", "cancelled"]) {
        validateOptionalDate(field, frontMatter[field] ?? "", errors);
    }
    validateActor("author", frontMatter.author ?? "", config, errors, warnings);
    validateAssignee(frontMatter.assignee ?? "", frontMatter.status ?? "", config, errors, warnings);
    if ((frontMatter.depends_on ?? "") !== "") {
        for (const dependency of (frontMatter.depends_on ?? "").split(",").map((item) => item.trim())) {
            if (!/^(TASK|EPIC)-[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(dependency)) {
                errors.push(`\`depends_on\` contains invalid plain ID: ${dependency}`);
            }
        }
    }
    if ((frontMatter.epic ?? "") !== "" && !/^EPIC-[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(frontMatter.epic ?? "")) {
        errors.push("`epic` must be a plain EPIC-* ID or empty");
    }
    if ((frontMatter.pr ?? "") !== "" && !/^https?:\/\//u.test(frontMatter.pr ?? "")) {
        warnings.push("`pr` is not an http(s) URL");
    }
}
function validateDependencies(frontMatter, idIndex, errors, warnings) {
    const idPattern = /^(TASK|EPIC)-[A-Za-z0-9][A-Za-z0-9_-]*$/u;
    for (const dependency of (frontMatter.depends_on ?? "").split(",").map((item) => item.trim())) {
        if (dependency === "" || !idPattern.test(dependency))
            continue;
        if (!(dependency in idIndex))
            errors.push(`\`depends_on\` references unknown ID: ${dependency}`);
        else if (idIndex[dependency]?.status === "cancelled") {
            warnings.push(`\`depends_on\` references a cancelled task: ${dependency}`);
        }
    }
    const epic = frontMatter.epic ?? "";
    if (/^EPIC-[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(epic)) {
        if (!(epic in idIndex))
            errors.push(`\`epic\` references unknown ID: ${epic}`);
        else if (idIndex[epic]?.kind !== "epic")
            errors.push(`\`epic\` references a non-epic ID: ${epic}`);
    }
}
function validateDirectoryLayout(file, id, kind, frontMatter, errors, warnings) {
    if (!kind)
        return;
    const todoRoot = findTodoAncestor(file);
    if (!todoRoot)
        return;
    let expected;
    try {
        expected = canonicalTodoPath(dirname(todoRoot), frontMatter.status ?? "", kind, id, frontMatter.epic ?? "");
    }
    catch {
        return;
    }
    if (resolve(file) === expected)
        return;
    const zone = dirname(expected);
    const group = kind === "epic" ? id : (frontMatter.epic ?? "");
    const zoneRoot = group === "" ? zone : dirname(zone);
    const legacy = resolve(zoneRoot, basename(file));
    const expectedRelative = relative(dirname(todoRoot), expected).replaceAll("\\", "/");
    if (resolve(file) === legacy && group !== "") {
        warnings.push(`legacy flat layout; canonical path is ${expectedRelative}`);
    }
    else {
        errors.push(`file must use canonical epic directory: ${expectedRelative}`);
    }
}
function findTodoAncestor(file) {
    let current = dirname(resolve(file));
    while (true) {
        if (basename(current) === "todo")
            return current;
        const parent = dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
function validateDate(field, value, errors) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})\s*\((\d{1,10})\))?$/u.exec(value);
    if (!match) {
        errors.push(`\`${field}\` must use YYYY-MM-DD or "YYYY-MM-DD HH:MM:SS (unix_ts)" format`);
        return;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        errors.push(`\`${field}\` contains an invalid date`);
        return;
    }
    if (match[4] !== undefined) {
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        const second = Number(match[6]);
        if (hour > 23 || minute > 59 || second > 59) {
            errors.push(`\`${field}\` contains an invalid time`);
            return;
        }
        if (match[7] !== undefined) {
            const local = Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000);
            const offset = local - Number(match[7]);
            if (offset < -12 * 3600 || offset > 14 * 3600 || offset % 900 !== 0) {
                errors.push(`\`${field}\` local time does not match the Unix timestamp (implied timezone offset is not plausible)`);
            }
        }
    }
}
function validateOptionalDate(field, value, errors) {
    if (value !== "")
        validateDate(field, value, errors);
}
function validateChangeHistory(body, errors) {
    const match = /^##\s+.*Change History/imu.exec(body);
    if (!match?.[0] || match.index === undefined)
        return;
    let rest = body.slice(match.index + match[0].length);
    const next = /^##\s+/mu.exec(rest);
    if (next?.index !== undefined)
        rest = rest.slice(0, next.index);
    let headerSeen = false;
    for (const line of rest.split(/\r\n|\r|\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|") || /^\|[\s:|-]+\|\s*$/u.test(trimmed))
            continue;
        const cells = trimmed.replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());
        if (!headerSeen) {
            headerSeen = true;
            continue;
        }
        if (cells[0])
            validateDate("change history date", cells[0], errors);
    }
}
function validateEnum(field, value, allowed, errors) {
    if (!allowed.includes(value))
        errors.push(`\`${field}\` must be one of: ${allowed.join(", ")}`);
}
function validateOptionalInteger(field, value, errors) {
    if (value !== "" && !/^\d+$/u.test(value))
        errors.push(`\`${field}\` must be an integer token count or empty`);
}
function validateTitle(body, id, errors) {
    const match = /^#\s+([^:\n]+):\s+.+$/mu.exec(body);
    if (!match?.[1]) {
        errors.push("missing H1 title in format `# ID: title`");
    }
    else if (match[1].trim() !== id) {
        errors.push(`H1 ID \`${match[1].trim()}\` does not match file ID \`${id}\``);
    }
}
function validateSections(body, kind, errors) {
    const sections = [
        ["Human Brief", /^##\s+0\.\s+Простое описание \(Human Brief\)/mu],
        ["Problem", /^###\s+Проблема простыми словами \(Problem\)/mu],
        ["Solution Sketch", /^###\s+Варианты или путь решения \(Solution Sketch\)/mu],
        ["Expected Result", /^###\s+Ожидаемый результат \(Expected Result\)/mu],
        ["Concept and Goal", /^##\s+\d+\.\s+.*Concept and Goal/mu],
        ["Context and Scope", /^##\s+\d+\.\s+.*Context and Scope/mu],
        ["Requirements", /^##\s+\d+\.\s+.*Requirements/mu],
        ["Implementation Plan", /^##\s+\d+\.\s+.*Implementation Plan/mu],
        ["Definition of Done", /^##\s+\d+\.\s+.*Definition of Done/mu],
    ];
    if (kind === "task")
        sections.push(["Verification", /^##\s+\d+\.\s+.*Verification/mu]);
    for (const [name, pattern] of sections)
        if (!pattern.test(body))
            errors.push(`missing section: ${name}`);
    if (!/^###\s+.*Must Have/mu.test(body))
        errors.push("missing Must Have requirements subsection");
    if (!/^###\s+.*Won[’']?t Have/mu.test(body))
        errors.push("missing Won't Have requirements subsection");
}
function validateFolderStatus(file, status, errors) {
    const path = file.replaceAll("\\", "/");
    const folders = [["done", "done"], ["cancelled", "cancelled"], ["backlog", "backlog"]];
    for (const [folder, expected] of folders) {
        if (path.includes(`/todo/${folder}/`)) {
            if (status !== expected)
                errors.push(`files in todo/${folder}/ must have \`status: ${expected}\``);
            return;
        }
    }
    if (status !== "" && !ACTIVE_STATUSES.includes(status)) {
        errors.push(`active todo/ files must have one of statuses: ${ACTIVE_STATUSES.join(", ")}`);
    }
}
function validateMarkdownLinks(file, body, errors) {
    for (const [, target] of extractMarkdownLinks(body)) {
        const path = stripLinkFragmentAndQuery(target);
        if (path === "")
            continue;
        let decoded;
        try {
            decoded = decodeURIComponent(path);
        }
        catch {
            decoded = path;
        }
        const candidate = isAbsolute(decoded) ? decoded : resolve(dirname(file), decoded);
        if (!existsSync(candidate))
            errors.push(`broken local markdown link \`${target}\``);
    }
}
function validateNoTemplatePlaceholders(content, errors) {
    const known = /<(роль|имя агента|YYYY-MM-DD|ссылка на PR|тип задачи|статус|категория|название задачи|краткое название задачи|краткое-название|Название эпика|действие|ценность|ситуация\/триггер|решение|результат)[^>\n]*>/u.exec(content);
    if (known?.[0])
        errors.push(`template placeholder found: ${known[0]}`);
    const field = /^\s*[A-Za-z_][A-Za-z0-9_-]*:\s*<[^>\n]+>/mu.exec(content);
    if (field?.[0])
        errors.push(`template placeholder found: ${field[0].trim()}`);
    const list = /^\s*(?:[-*]|\d+\.)\s*(?:\[[ xX]\]\s*)?<[^>\n]+>\.?\s*$/mu.exec(content);
    if (list?.[0])
        errors.push(`template placeholder found: ${list[0].trim()}`);
    if (/^\s*-\s*\[\s*\]\s*\.\.\.\s*$/mu.test(content)) {
        errors.push("unfinished checklist placeholder found: `- [ ] ...`");
    }
    if (/^\s*-\s*\.\.\.\s*$/mu.test(content))
        errors.push("unfinished list placeholder found: `- ...`");
}
function validateAssignee(value, status, config, errors, warnings) {
    if (value.trim() === "") {
        if (!ASSIGNEE_REQUIRED_STATUSES.includes(status))
            return;
        actorIssue(errors, warnings, config.strict, `\`assignee\` must not be empty for status \`${status}\` — expected \`<роль> (<агент>)\`, e.g. \`Бэкендер (codex-cli)\``);
        return;
    }
    validateActor("assignee", value, config, errors, warnings);
}
function validateActor(field, value, config, errors, warnings) {
    const trimmed = value.trim();
    if (trimmed === "") {
        actorIssue(errors, warnings, config.strict, `\`${field}\` must not be empty — expected \`<роль> (<агент>)\`, e.g. \`Бэкендер (codex-cli)\``);
        return;
    }
    const match = /^(.+) \(([a-z0-9][a-z0-9_-]*)\)\s*$/u.exec(trimmed);
    if (!match?.[1] || !match[2]) {
        actorIssue(errors, warnings, config.strict, `\`${field}\` must use format \`<роль> (<агент>)\` with a lowercase agent id, e.g. \`Бэкендер (codex-cli)\` — got \`${trimmed}\``);
        return;
    }
    const role = match[1].trim();
    const agent = match[2];
    const agents = config.agents.length > 0 ? config.agents : AI_AGENTS;
    if (!agents.includes(agent)) {
        actorIssue(errors, warnings, config.strict, `\`${field}\` agent \`${agent}\` is not a known agent: ${agents.join(", ")}`);
    }
    if (config.roles.length > 0 && !config.roles.includes(role)) {
        actorIssue(errors, warnings, config.strict, `\`${field}\` role \`${role}\` is not in the project roles list`);
    }
}
function actorIssue(errors, warnings, strict, message) {
    (strict ? errors : warnings).push(message);
}
//# sourceMappingURL=validator.js.map