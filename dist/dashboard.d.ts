import type { ExportRecord } from "./domain.js";
/**
 * Rebuilds the derived `url` for every record from its `file` and drops any
 * `url` that came from the input: JSONL is external data, so its `url` must
 * never reach an href as-is. A relative `file` resolves against `base`; without
 * a base the record simply carries no link.
 */
export declare function withFileUrls(records: ExportRecord[], base?: string): ExportRecord[];
export declare function renderDashboard(records: ExportRecord[], title?: string, base?: string): string;
