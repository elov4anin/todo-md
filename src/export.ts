import { readFileSync } from "node:fs";
import {
  detectFolder,
  detectKind,
  extractTitle,
  fileId,
  makeRelativePath,
  parseFrontMatter,
  parseSimpleYaml,
  removeBom,
  valueOrNull,
} from "./parser.js";
import type { ExportRecord } from "./domain.js";

export function extractRecord(file: string, cwd: string): ExportRecord | null {
  let content: string;
  try { content = removeBom(readFileSync(file, "utf8")); } catch { return null; }
  const parsed = parseFrontMatter(content);
  const warnings: string[] = [];
  const frontMatter = parsed.error ? {} : parseSimpleYaml(parsed.frontMatter, warnings);
  const body = parsed.error ? content : parsed.body;
  const id = fileId(file);
  const kind = detectKind(id) ?? "task";
  const dependencies = (frontMatter.depends_on ?? "").trim();
  const dependsOn = dependencies === "" ? [] : dependencies.split(/\s*,\s*/u);
  const dates: string[] = [];
  const history = /^##\s+.*Change\s+History/imu.exec(body);
  if (history?.index !== undefined) {
    const rest = body.slice(history.index);
    for (const match of rest.matchAll(/^\|\s*(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}:\d{2}\s*\(\d{1,10}\))?\s*\|/gmu)) {
      dates.push(`${match[1]}-${match[2]}-${match[3]}`);
    }
  }
  dates.sort();
  const folder = detectFolder(file);
  const fallbackStatus = folder === "done" ? "done" : folder === "cancelled" ? "cancelled" : folder === "backlog" ? "backlog" : "todo";
  const status = valueOrNull(frontMatter.status) ?? fallbackStatus;
  return {
    id,
    kind: kind.toUpperCase() as "TASK" | "EPIC",
    title: extractTitle(body, id),
    file: makeRelativePath(file, cwd),
    folder,
    status,
    type: valueOrNull(frontMatter.type),
    priority: valueOrNull(frontMatter.priority),
    value: valueOrNull(frontMatter.value),
    complexity: valueOrNull(frontMatter.complexity),
    epic: valueOrNull(frontMatter.epic),
    depends_on: dependsOn,
    assignee: valueOrNull(frontMatter.assignee),
    author: valueOrNull(frontMatter.author),
    created: valueOrNull(frontMatter.created),
    due: valueOrNull(frontMatter.due),
    started: valueOrNull(frontMatter.started),
    completed: valueOrNull(frontMatter.completed),
    cost_plan: valueOrNull(frontMatter.cost_plan),
    cost_fact: valueOrNull(frontMatter.cost_fact),
    first_change: dates[0] ?? null,
    last_change: dates.at(-1) ?? null,
  };
}

export function recordsToJsonl(records: ExportRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}
