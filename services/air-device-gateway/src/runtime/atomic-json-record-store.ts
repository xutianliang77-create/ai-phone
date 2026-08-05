import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const MAX_FILE_BYTES = 16 * 1024 * 1024;

export class AtomicJsonRecordStore<T> {
  private readonly path: string;
  private readonly records = new Map<string, T>();
  private loaded = false;
  private writeSequence = 0;
  private tail = Promise.resolve();

  constructor(path: string, private readonly options: {
    label: string;
    idOf: (record: T) => string | null;
  }) {
    if (!isAbsolute(path) || path.length > 1_024 || resolve(path) === "/") {
      throw new Error(`${options.label} path is invalid`);
    }
    this.path = resolve(path);
  }

  load() {
    return this.schedule(async () => {
      if (this.loaded) return this.snapshot();
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      let body: string;
      try {
        const metadata = await stat(this.path);
        if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) {
          throw new Error(`${this.options.label} is invalid`);
        }
        body = await readFile(this.path, "utf8");
      } catch (error) {
        if (isMissing(error)) {
          this.loaded = true;
          return [];
        }
        throw error;
      }
      const parsed = parseRecords<T>(body, this.options.label);
      this.records.clear();
      for (const record of parsed) {
        const id = this.options.idOf(record);
        if (!id || this.records.has(id)) {
          throw new Error(`${this.options.label} is invalid`);
        }
        this.records.set(id, structuredClone(record));
      }
      this.loaded = true;
      return this.snapshot();
    });
  }

  upsert(record: T) {
    return this.schedule(async () => {
      this.assertLoaded();
      const id = this.options.idOf(record);
      if (!id) throw new Error(`${this.options.label} record is invalid`);
      const previous = this.records.get(id);
      this.records.set(id, structuredClone(record));
      try {
        await this.persist();
      } catch (error) {
        if (previous) this.records.set(id, previous);
        else this.records.delete(id);
        throw error;
      }
    });
  }

  remove(id: string) {
    return this.schedule(async () => {
      this.assertLoaded();
      const previous = this.records.get(id);
      if (!previous) return;
      this.records.delete(id);
      try {
        await this.persist();
      } catch (error) {
        this.records.set(id, previous);
        throw error;
      }
    });
  }

  private snapshot() {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  private assertLoaded() {
    if (!this.loaded) throw new Error(`${this.options.label} is not loaded`);
  }

  private async persist() {
    const body = `${JSON.stringify({ version: 1, records: this.snapshot() })}\n`;
    if (Buffer.byteLength(body) > MAX_FILE_BYTES) {
      throw new Error(`${this.options.label} exceeds its size limit`);
    }
    const temporary = `${this.path}.${process.pid}.${++this.writeSequence}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(body, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private schedule<R>(work: () => Promise<R>) {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function parseRecords<T>(body: string, label: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.records)) {
    if (isObject(parsed) && parsed.version !== 1) {
      throw new Error(`${label} version is unsupported`);
    }
    throw new Error(`${label} is invalid`);
  }
  return parsed.records as T[];
}

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
