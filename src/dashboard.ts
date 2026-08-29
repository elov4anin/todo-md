import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExportRecord } from "./domain.js";

/**
 * Rebuilds the derived `url` for every record from its `file` and drops any
 * `url` that came from the input: JSONL is external data, so its `url` must
 * never reach an href as-is. A relative `file` resolves against `base`; without
 * a base the record simply carries no link.
 */
export function withFileUrls(records: ExportRecord[], base?: string): ExportRecord[] {
  const absBase = base ? resolve(base) : undefined;
  return records.map((record) => {
    const { url: _untrusted, ...rest } = record;
    if (!record.file) return rest;
    const path = isAbsolute(record.file) ? record.file : absBase ? resolve(absBase, record.file) : undefined;
    return path ? { ...rest, url: pathToFileURL(path).href } : rest;
  });
}

export function renderDashboard(records: ExportRecord[], title = "Задачи", base?: string): string {
  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  const template = readFileSync(resolve(packageRoot, "assets/dashboard-template.html"), "utf8");
  const chart = readFileSync(resolve(packageRoot, "assets/chart.umd.js"), "utf8");
  const tasks = withFileUrls(records, base);
  const json = JSON.stringify(tasks, null, 2).replaceAll("</script", "<\\/script");
  return template
    .replaceAll("__TITLE__", escapeHtml(title))
    .replace("__CHART_JS__", chart)
    .replace("__DATA__", json)
    .replaceAll("__COUNT__", String(tasks.length));
}

function findPackageRoot(start: string): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(resolve(directory, "assets/dashboard-template.html"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`cannot locate dashboard assets from ${start}`);
    directory = parent;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}
