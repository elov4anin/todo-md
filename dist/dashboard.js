import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
export function renderDashboard(records, title = "Задачи", base) {
    const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    const template = readFileSync(resolve(packageRoot, "assets/dashboard-template.html"), "utf8");
    const chart = readFileSync(resolve(packageRoot, "assets/chart.umd.js"), "utf8");
    const absBase = base ? resolve(base) : undefined;
    const tasks = records.map((record) => {
        if (!record.file)
            return record;
        const path = isAbsolute(record.file) ? record.file : absBase ? resolve(absBase, record.file) : undefined;
        return path ? { ...record, url: pathToFileURL(path).href } : record;
    });
    const json = JSON.stringify(tasks, null, 2).replaceAll("</script", "<\\/script");
    return template
        .replaceAll("__TITLE__", escapeHtml(title))
        .replace("__CHART_JS__", chart)
        .replace("__DATA__", json)
        .replaceAll("__COUNT__", String(tasks.length));
}
function findPackageRoot(start) {
    let directory = resolve(start);
    while (true) {
        if (existsSync(resolve(directory, "assets/dashboard-template.html")))
            return directory;
        const parent = dirname(directory);
        if (parent === directory)
            throw new Error(`cannot locate dashboard assets from ${start}`);
        directory = parent;
    }
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/gu, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[character] ?? character);
}
//# sourceMappingURL=dashboard.js.map