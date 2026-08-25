export interface CliIo {
    cwd: () => string;
    stdout: (value: string) => void;
    stderr: (value: string) => void;
    stdin: () => string;
}
export declare function main(argv: string[], io?: CliIo): number;
