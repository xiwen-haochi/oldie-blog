import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { backendName, sqliteGet, sqlitePut, databaseFile } from './db.js';

/** Which backend a store should use. Set once at boot from the site config. */
let driver = 'json';
export function setDataDriver(name) {
  driver = backendName({ dataDriver: name });
  return driver;
}
export function getDataDriver() {
  return driver;
}

/**
 * Runtime store. Two interchangeable backends:
 *
 *   json    – one file per store, atomic writes (tmp + rename). Human
 *            readable, which is why it is the default.
 *   sqlite – everything in data/oldie.sqlite through node:sqlite, which
 *            ships with Node itself, so still no dependency to install.
 *
 * Reads are cached either way; writes go through a promise chain so two
 * requests can never interleave.
 */
export class JsonStore {
  #file;
  #name;
  #fallback;
  #cache = null;
  #queue = Promise.resolve();

  constructor(file, fallback = {}, options = {}) {
    this.#file = file;
    this.#name = options.name || path.basename(file).replace(/\.json$/, '');
    this.#fallback = fallback;
  }

  get file() {
    return this.#file;
  }

  get name() {
    return this.#name;
  }

  get backend() {
    return driver;
  }

  /** Synchronous read of the cached value, loading from storage on first use. */
  sync() {
    if (this.#cache === null) this.#cache = this.#loadSync();
    return this.#cache;
  }

  #loadSync() {
    if (driver === 'sqlite') return sqliteGet(this.#name, this.#fallback);
    try {
      return JSON.parse(fs.readFileSync(this.#file, 'utf8'));
    } catch {
      return structuredClone(this.#fallback);
    }
  }

  async read() {
    if (this.#cache !== null) return this.#cache;
    if (driver === 'sqlite') {
      this.#cache = sqliteGet(this.#name, this.#fallback);
      return this.#cache;
    }
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
    if (driver === 'sqlite') {
      sqlitePut(this.#name, value);
      return value;
    }
    await fsp.mkdir(path.dirname(this.#file), { recursive: true });
    const tmp = this.#file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fsp.rename(tmp, this.#file);
    return value;
  }

  /** Drop the cache so the next read hits storage (settings hot-reload). */
  invalidate() {
    this.#cache = null;
  }

  where() {
    return driver === 'sqlite' ? databaseFile() : this.#file;
  }
}
