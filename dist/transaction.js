import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export class FileTransaction {
    #writes = new Map();
    #deletes = new Set();
    #snapshots = new Map();
    #committed = false;
    write(file, content) {
        this.#writes.set(file, content);
        this.#deletes.delete(file);
    }
    delete(file) {
        this.#writes.delete(file);
        this.#deletes.add(file);
    }
    commit() {
        if (this.#committed)
            throw new Error("transaction already committed");
        const touched = new Set([...this.#writes.keys(), ...this.#deletes]);
        for (const file of touched) {
            this.#snapshots.set(file, existsSync(file)
                ? { existed: true, content: readFileSync(file) }
                : { existed: false });
        }
        const temporary = [];
        try {
            for (const [file, content] of this.#writes) {
                mkdirSync(dirname(file), { recursive: true });
                const temp = `${file}.todo-md-${randomUUID()}.tmp`;
                writeFileSync(temp, content);
                temporary.push(temp);
                if (process.platform === "win32" && existsSync(file))
                    rmSync(file);
                renameSync(temp, file);
            }
            for (const file of this.#deletes) {
                if (existsSync(file))
                    rmSync(file);
            }
            this.#committed = true;
        }
        catch (error) {
            for (const temp of temporary)
                if (existsSync(temp))
                    rmSync(temp, { force: true });
            this.rollback();
            throw error;
        }
    }
    rollback() {
        for (const [file, snapshot] of this.#snapshots) {
            if (snapshot.existed && snapshot.content) {
                mkdirSync(dirname(file), { recursive: true });
                writeFileSync(file, snapshot.content);
            }
            else if (existsSync(file)) {
                rmSync(file, { force: true });
            }
        }
        this.#committed = false;
    }
}
//# sourceMappingURL=transaction.js.map