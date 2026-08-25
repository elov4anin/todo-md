export interface CreateOptions {
    type?: string;
    title?: string;
    value?: string;
    complexity?: string;
    priority?: string;
    author?: string;
    status?: string;
    epic?: string;
    depends_on?: string;
}
export declare function resolveRoot(cwd: string): string;
export declare function nowTimestamp(now?: Date): string;
export declare function setFieldInContent(content: string, field: string, value: string): string;
export declare function getFieldFromContent(content: string, field: string): string | null;
export declare function rewriteOutboundLinks(content: string, fromDir: string, toDir: string): string;
export declare function computeInboundRewrites(root: string, oldFile: string, newFile: string): Map<string, string>;
export declare function transition(root: string, id: string, newStatus: string, options?: {
    assignee?: string;
}): string;
export declare function create(root: string, id: string, options?: CreateOptions): string;
export declare function setFields(root: string, id: string, fields: Record<string, string>): string;
