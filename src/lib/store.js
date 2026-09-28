import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Tiny append-friendly JSON store. No native deps, so cloning the repo never
 * means fighting a compiler. Writes are atomic (tmp file + rename) and
 * serialised through a promise chain so concurrent requests cannot interleave.
 */
export class JsonStore {
  #file;
  #fallback;
  #cache = null;
  #queue = Promise.resolve();

  constructor(file, fallback = {}) {
    this.#file = file;
    this.#fallback = fallback;
  }

  get file() {
    return this.#file;
  }

  sync() {
    if (this.#cache === null) this.#cache = this.#loadSync();
    return this.#cache;
  }

  #loadSync() {
    try {
      return JSON.parse(fs.readFileSync(this.#file, 'utf8'));
    } catch {
      return structuredClone(this.#fallback);
    }
  }

  async read() {
    if (this.#cache !== null) return this.#cache;
    try {
      this.#cache = JSON.parse(await fsp.readFile(this.#file, 'utf8'));
    } catch {
      this.#cache = structuredClone(this.#fallback);
    }
    return this.#cache;
  }

  /** Serialised read-modify-write. */
  update(mutator) {
    const run = async () => {
      const current = await this.read();
      const next = (await mutator(current)) ?? current;
      this.#cache = next;
      await this.flush(next);
      return next;
    };
    this.#queue = this.#queue.then(run, run);
    return this.#queue;
  }

  async flush(value = this.sync()) {
    await fsp.mkdir(path.dirname(this.#file), { recursive: true });
    const tmp = `${this.#file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fsp.rename(tmp, this.#file);
    return value;
  }

  /** Drop the cache so the next read hits disk (used by settings hot-reload). */
  invalidate() {
    this.#cache = null;
  }
}
