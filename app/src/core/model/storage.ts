// Where the app keeps its things: a few JSON documents and some binary
// files, by path. On the phone it's the app's documents folder
// (src/services/storage.ts); in tests and demo mode, memory.

export interface Storage {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | null>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  /** No error if it isn't there. */
  remove(path: string): Promise<void>;
}

export class MemoryStorage implements Storage {
  readonly files = new Map<string, string | Uint8Array>();

  async readText(path: string) {
    const f = this.files.get(path);
    return typeof f === 'string' ? f : null;
  }
  async writeText(path: string, text: string) {
    this.files.set(path, text);
  }
  async readBytes(path: string) {
    const f = this.files.get(path);
    return f instanceof Uint8Array ? f.slice() : null;
  }
  async writeBytes(path: string, data: Uint8Array) {
    this.files.set(path, data.slice());
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

/**
 * A JSON document with a version number. A file that's missing, unreadable
 * or from a newer app version gives the fallback instead of an error, so a
 * broken file never stops the app from starting.
 */
export class JsonDoc<T> {
  constructor(
    private readonly storage: Storage,
    private readonly path: string,
    private readonly version: number,
    private readonly fallback: () => T,
  ) {}

  async load(): Promise<T> {
    try {
      const text = await this.storage.readText(this.path);
      if (!text) return this.fallback();
      const doc = JSON.parse(text) as { v: number; data: T };
      if (doc.v !== this.version) return this.fallback();
      return doc.data;
    } catch {
      return this.fallback();
    }
  }

  async save(data: T): Promise<void> {
    await this.storage.writeText(this.path, JSON.stringify({ v: this.version, data }));
  }
}

/** Sortable, unique enough ids: time, then randomness. */
export function newId(now = Date.now(), random: () => number = Math.random): string {
  const r = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${now.toString(36)}${r}`;
}
