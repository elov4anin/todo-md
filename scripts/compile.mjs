import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc")], {
  cwd: root,
  stdio: "inherit",
});

const chartSource = resolve(root, "node_modules/chart.js/dist/chart.umd.js");
const chartTarget = resolve(root, "assets/chart.umd.js");
mkdirSync(dirname(chartTarget), { recursive: true });
copyFileSync(chartSource, chartTarget);
