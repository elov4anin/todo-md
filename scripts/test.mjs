import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".test-dist");
rmSync(output, { recursive: true, force: true });

const compile = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.test.json"], {
  cwd: root,
  stdio: "inherit",
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

const tests = spawnSync(process.execPath, ["--test", ".test-dist/tests/**/*.test.js"], {
  cwd: root,
  stdio: "inherit",
});
rmSync(output, { recursive: true, force: true });
process.exit(tests.status ?? 1);
