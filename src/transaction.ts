import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

interface Snapshot {
  existed: boolean;
  content?: Buffer;
}

export class FileTransaction {
  readonly #writes = new Map<string, string | Buffer>();
  readonly #deletes = new Set<string>();
  readonly #snapshots = new Map<string, Snapshot>();
  #committed = false;

  write(file: string, content: string | Buffer): void {
    this.#writes.set(file, content);
    this.#deletes.delete(file);
  }

  delete(file: string): void {
    this.#writes.delete(file);
    this.#deletes.add(file);
  }

  commit(): void {
    if (this.#committed) throw new Error("transaction already committed");
    const touched = new Set([...this.#writes.keys(), ...this.#deletes]);
    for (const file of touched) {
      this.#snapshots.set(file, existsSync(file)
        ? { existed: true, content: readFileSync(file) }
        : { existed: false });
    }
    const temporary: string[] = [];
    try {
      for (const [file, content] of this.#writes) {
        mkdirSync(dirname(file), { recursive: true });
        const temp = `${file}.todo-md-${randomUUID()}.tmp`;
        writeFileSync(temp, content);
        temporary.push(temp);
        if (process.platform === "win32" && existsSync(file)) rmSync(file);
        renameSync(temp, file);
      }
      for (const file of this.#deletes) {
        if (existsSync(file)) rmSync(file);
      }
      this.#committed = true;
    } catch (error) {
      for (const temp of temporary) if (existsSync(temp)) rmSync(temp, { force: true });
      this.rollback();
      throw error;
    }
  }

  rollback(): void {
    for (const [file, snapshot] of this.#snapshots) {
      if (snapshot.existed && snapshot.content) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, snapshot.content);
      } else if (existsSync(file)) {
        rmSync(file, { force: true });
      }
    }
    this.#committed = false;
  }
}
