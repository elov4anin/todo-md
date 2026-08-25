import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { FOLDER_FOR_STATUS, } from "./domain.js";
export function removeBom(content) {
    return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
export function detectEol(content) {
    return content.includes("\r\n") ? "\r\n" : "\n";
}
export function parseFrontMatter(content) {
    const lines = content.split(/\r\n|\r|\n/);
    if (lines.length === 0 || lines[0]?.trim() !== "---") {
        return { frontMatter: "", body: "", error: "missing YAML front matter opening delimiter ---" };
    }
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing === -1) {
        return { frontMatter: "", body: "", error: "missing YAML front matter closing delimiter ---" };
    }
    return {
        frontMatter: lines.slice(1, closing).join("\n"),
        body: lines.slice(closing + 1).join("\n"),
        error: null,
    };
}
export function stripInlineComment(value) {
    let inSingle = false;
    let inDouble = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character === "'" && !inDouble) {
            inSingle = !inSingle;
        }
        else if (character === '"' && !inSingle) {
            inDouble = !inDouble;
        }
        else if (character === "#" && !inSingle && !inDouble) {
            const previous = index === 0 ? " " : value[index - 1] ?? " ";
            if (/\s/u.test(previous))
                return value.slice(0, index).trimEnd();
        }
    }
    return value.trim();
}
export function parseSimpleYaml(yaml, warnings = []) {
    const data = {};
    yaml.split(/\r\n|\r|\n/).forEach((line, lineNumber) => {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#"))
            return;
        const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
        if (!match) {
            warnings.push(`front matter line ${lineNumber + 2} is not a simple key: value pair`);
            return;
        }
        const key = match[1];
        if (!key)
            return;
        data[key] = stripInlineComment(match[2] ?? "").replace(/^[\s"']+|[\s"']+$/gu, "");
    });
    return data;
}
export function fileId(file) {
    return basename(file).slice(0, -".todo.md".length);
}
export function detectKind(id) {
    if (id.startsWith("TASK-"))
        return "task";
    if (id.startsWith("EPIC-"))
        return "epic";
    return null;
}
export function slugify(text) {
    return text.trim().toLocaleLowerCase("en-US").normalize("NFKD")
        .replace(/[\u0300-\u036f]/gu, "")
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .replace(/-{2,}/gu, "-");
}
function walkFiles(directory, output) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isSymbolicLink())
            continue;
        if (entry.isDirectory())
            walkFiles(file, output);
        else if (entry.isFile() && file.endsWith(".todo.md"))
            output.push(file);
    }
}
export function findTodoFiles(target) {
    if (!existsSync(target))
        return [];
    const path = realpathSync(target);
    const stat = lstatSync(path);
    if (stat.isFile())
        return path.endsWith(".todo.md") ? [path] : [];
    let searchRoot = path;
    if (basename(path) !== "todo" && existsSync(resolve(path, "todo")))
        searchRoot = resolve(path, "todo");
    const files = [];
    walkFiles(searchRoot, files);
    return files;
}
export function findFileById(root, id) {
    const expected = `${id}.todo.md`;
    return findTodoFiles(resolve(root, "todo")).find((file) => basename(file) === expected) ?? null;
}
export function buildIdIndex(files) {
    const index = {};
    for (const file of files) {
        const parsed = parseFrontMatter(removeBom(readFileSync(file, "utf8")));
        const id = fileId(file);
        const kind = detectKind(id);
        if (parsed.error || !kind)
            continue;
        index[id] = { kind, status: parseSimpleYaml(parsed.frontMatter).status ?? "", file };
    }
    return index;
}
export function makeRelativePath(path, baseDir) {
    const rel = relative(realpathOrResolve(baseDir), realpathOrResolve(path));
    return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel) ? rel : path;
}
function realpathOrResolve(path) {
    return existsSync(path) ? realpathSync(path) : resolve(path);
}
export function detectFolder(file) {
    const match = /\/(done|backlog|cancelled)\//u.exec(file.replaceAll("\\", "/"));
    return match?.[1] ?? "active";
}
export function folderForStatus(status) {
    return FOLDER_FOR_STATUS[status] ?? "";
}
export function normalizeMarkdownLinkTarget(rawTarget) {
    let target = rawTarget.trim();
    if (target === "")
        return null;
    if (target.startsWith("<") && target.includes(">")) {
        target = target.slice(1, target.indexOf(">"));
    }
    else {
        const titleMatch = /^(\S+)\s+["'][^"']*["']$/u.exec(target);
        if (titleMatch?.[1])
            target = titleMatch[1];
    }
    return target.trim();
}
export function shouldSkipLinkTarget(target) {
    return target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target);
}
export function stripLinkFragmentAndQuery(target) {
    return target.split("#", 1)[0]?.split("?", 1)[0] ?? "";
}
export function extractMarkdownLinks(body) {
    const links = [];
    for (const match of body.matchAll(/!?\[[^\]\n]*]\(([^)\n]+)\)/g)) {
        const full = match[0];
        if (full.startsWith("!"))
            continue;
        const normalized = normalizeMarkdownLinkTarget(match[1] ?? "");
        if (normalized && !shouldSkipLinkTarget(normalized))
            links.push([full, normalized]);
    }
    return links;
}
export function extractTitle(body, id) {
    for (const line of body.split(/\r\n|\r|\n/)) {
        const match = /^#\s+(.*)$/u.exec(line);
        if (!match?.[1])
            continue;
        const heading = match[1].trim();
        if (heading.startsWith(`${id}:`))
            return heading.slice(id.length + 1).trim();
        const colon = heading.indexOf(":");
        return colon === -1 ? heading : heading.slice(colon + 1).trim();
    }
    return "";
}
export function valueOrNull(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
export function resolveMarkdownPath(base, target) {
    return isAbsolute(target) ? resolve(target) : resolve(dirname(base), target);
}
//# sourceMappingURL=parser.js.map