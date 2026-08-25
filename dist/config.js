import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TodoMdError } from "./domain.js";
export const DEFAULT_CONFIG = { roles: [], agents: [], strict: false };
export function loadConfig(root) {
    const jsonFile = resolve(root, ".todo-md.json");
    const legacyFile = resolve(root, ".todo-md.php");
    if (!existsSync(jsonFile)) {
        if (existsSync(legacyFile)) {
            throw new TodoMdError("legacy .todo-md.php found; migrate it to .todo-md.json (PHP config is not supported)");
        }
        return { ...DEFAULT_CONFIG, roles: [], agents: [] };
    }
    return loadConfigFile(jsonFile);
}
export function loadConfigFile(file) {
    if (!existsSync(file))
        return { ...DEFAULT_CONFIG, roles: [], agents: [] };
    let value;
    try {
        value = JSON.parse(readFileSync(file, "utf8"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TodoMdError(`invalid JSON config ${file}: ${message}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TodoMdError(`config must be a JSON object: ${file}`);
    }
    const raw = value;
    const roles = stringList(raw.roles, "roles", file);
    const agents = stringList(raw.agents, "agents", file);
    if (raw.strict !== undefined && typeof raw.strict !== "boolean") {
        throw new TodoMdError(`config field \`strict\` must be boolean: ${file}`);
    }
    return { roles, agents, strict: raw.strict === true };
}
function stringList(value, field, file) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new TodoMdError(`config field \`${field}\` must be an array of strings: ${file}`);
    }
    return [...new Set(value)];
}
//# sourceMappingURL=config.js.map