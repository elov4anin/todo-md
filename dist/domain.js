export const TASK_TYPES = [
    "fix", "feat", "build", "chore", "ci", "docs", "style",
    "refactor", "perf", "test", "revert",
];
export const VALUES = ["V0", "V1", "V2", "V3", "V4"];
export const COMPLEXITIES = ["C0", "C1", "C2", "C3", "C4", "C5"];
export const PRIORITIES = ["P0", "P1", "P2", "P3"];
export const STATUSES = [
    "todo", "backlog", "in_progress", "paused", "blocked", "review", "done", "cancelled",
];
export const ACTIVE_STATUSES = ["todo", "in_progress", "paused", "blocked", "review"];
export const AI_AGENTS = [
    "gemini-cli", "codex-cli", "codex", "opencode", "roocode", "kilocode", "pi",
];
export const FOLDER_FOR_STATUS = {
    todo: "",
    in_progress: "",
    paused: "",
    blocked: "",
    review: "",
    backlog: "backlog",
    done: "done",
    cancelled: "cancelled",
};
export const LIFECYCLE_FIELD = {
    in_progress: "started",
    done: "completed",
    cancelled: "cancelled",
};
export class TodoMdError extends Error {
    name = "TodoMdError";
}
//# sourceMappingURL=domain.js.map