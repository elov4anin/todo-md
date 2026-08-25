export declare class FileTransaction {
    #private;
    write(file: string, content: string | Buffer): void;
    delete(file: string): void;
    commit(): void;
    rollback(): void;
}
