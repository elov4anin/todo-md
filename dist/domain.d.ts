export declare const TASK_TYPES: readonly ["fix", "feat", "build", "chore", "ci", "docs", "style", "refactor", "perf", "test", "revert"];
export declare const VALUES: readonly ["V0", "V1", "V2", "V3", "V4"];
export declare const COMPLEXITIES: readonly ["C0", "C1", "C2", "C3", "C4", "C5"];
export declare const PRIORITIES: readonly ["P0", "P1", "P2", "P3"];
export declare const STATUSES: readonly ["todo", "backlog", "in_progress", "paused", "blocked", "review", "done", "cancelled"];
export declare const ACTIVE_STATUSES: readonly ["todo", "in_progress", "paused", "blocked", "review"];
export declare const AI_AGENTS: readonly ["gemini-cli", "codex-cli", "codex", "opencode", "roocode", "kilocode", "pi"];
export type TaskKind = "task" | "epic";
export type TaskType = (typeof TASK_TYPES)[number] | "epic";
export type TaskStatus = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Complexity = (typeof COMPLEXITIES)[number];
export type Value = (typeof VALUES)[number];
export declare const FOLDER_FOR_STATUS: Record<TaskStatus, string>;
export declare const LIFECYCLE_FIELD: Partial<Record<TaskStatus, string>>;
export interface IdIndexEntry {
    kind: TaskKind;
    status: string;
    file: string;
}
export type IdIndex = Record<string, IdIndexEntry>;
export interface TodoMdConfig {
    roles: string[];
    agents: string[];
    strict: boolean;
}
export interface ValidationResult {
    errors: string[];
    warnings: string[];
}
export interface ExportRecord {
    id: string;
    kind: "TASK" | "EPIC";
    title: string;
    file: string;
    folder: string;
    status: string;
    type: string | null;
    priority: string | null;
    value: string | null;
    complexity: string | null;
    epic: string | null;
    depends_on: string[];
    assignee: string | null;
    author: string | null;
    created: string | null;
    due: string | null;
    started: string | null;
    completed: string | null;
    cost_plan: string | null;
    cost_fact: string | null;
    first_change: string | null;
    last_change: string | null;
    url?: string;
}
export declare class TodoMdError extends Error {
    readonly name = "TodoMdError";
}
