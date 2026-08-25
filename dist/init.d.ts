export interface InitOptions {
    force?: boolean;
    docsPath?: string;
    agentsPath?: string;
}
export interface InitResult {
    lines: string[];
    copied: number;
    updated: number;
    skipped: number;
}
export declare function initProject(target: string, options?: InitOptions): InitResult;
