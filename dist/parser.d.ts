import { type IdIndex, type TaskKind } from "./domain.js";
export interface ParsedFrontMatter {
    frontMatter: string;
    body: string;
    error: string | null;
}
export declare function removeBom(content: string): string;
export declare function detectEol(content: string): "\n" | "\r\n";
export declare function parseFrontMatter(content: string): ParsedFrontMatter;
export declare function stripInlineComment(value: string): string;
export declare function parseSimpleYaml(yaml: string, warnings?: string[]): Record<string, string>;
export declare function fileId(file: string): string;
export declare function detectKind(id: string): TaskKind | null;
export declare function slugify(text: string): string;
export declare function findTodoFiles(target: string): string[];
export declare function findFileById(root: string, id: string): string | null;
export declare function buildIdIndex(files: string[]): IdIndex;
export declare function makeRelativePath(path: string, baseDir: string): string;
export declare function detectFolder(file: string): "active" | "backlog" | "done" | "cancelled";
export declare function folderForStatus(status: string): string;
export declare function normalizeMarkdownLinkTarget(rawTarget: string): string | null;
export declare function shouldSkipLinkTarget(target: string): boolean;
export declare function stripLinkFragmentAndQuery(target: string): string;
export declare function extractMarkdownLinks(body: string): Array<[string, string]>;
export declare function extractTitle(body: string, id: string): string;
export declare function valueOrNull(value: string | undefined | null): string | null;
export declare function resolveMarkdownPath(base: string, target: string): string;
