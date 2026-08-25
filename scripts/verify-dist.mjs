import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const binary = resolve(root, "dist/bin/todo-md.js");
const required = [
  binary,
  resolve(root, "assets/dashboard-template.html"),
  resolve(root, "assets/chart.umd.js"),
  resolve(root, "assets/init/AGENTS.md"),
  resolve(root, "schemas/config.schema.json"),
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`missing packaged artifact: ${file}`);
}
if (!readFileSync(binary, "utf8").startsWith("#!/usr/bin/env node")) {
  throw new Error("compiled CLI is missing the node shebang");
}
const result = spawnSync(process.execPath, [binary, "--help"], { cwd: root, encoding: "utf8" });
if (result.status !== 0 || !result.stdout.includes("todo-md")) {
  throw new Error(`compiled CLI smoke test failed: ${result.stderr}`);
}
