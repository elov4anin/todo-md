import type { ExportRecord } from "./domain.js";
export declare function extractRecord(file: string, cwd: string): ExportRecord | null;
export declare function recordsToJsonl(records: ExportRecord[]): string;
