import { sqliteGet, sqlitePut, sqliteDelete, databaseFile } from './db.js';

/**
 * The runtime store. One implementation, one file: data/oldie.sqlite.
 *
 * A "store" is a named JSON document inside that single database. Settings,
 * hit counts, the guestbook, subscribers and sessions are each one of them;
 * articles live alongside under their own keys (post:<slug>, page:<slug>).
 *
 * Reads are cached; writes go through a promise chain so two requests can never
 * interleave and lose one another's change.
 */
export class Store {
  #name;
  #fallback;
  #cache = null;
  #queue = Promise.resolve();

  constructor(name, fallback = {}) {
    this.#name = String(name);
    this.#fallback = fallback;
  }

  get name() {
    return this.#name;
  }

  get backend() {
    return 'sqlite';
  }

  get file() {
    return databaseFile();
  }

  /** Where this store physically lives, for the admin screens. */
  where() {
    return databaseFile();
  }

  /** Synchronous read of the cached value, loading from storage on first use. */
  sync() {
    if (this.#cache === null) this.#cache = this.#load();
    return this.#cache;
  }

  #load() {
    return sqliteGet(this.#name, this.#fallback);
  }

  async read() {
    if (this.#cache !== null) return this.#cache;
    this.#cache = this.#load();
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
    sqlitePut(this.#name, value);
    return value;
  }

  /** Drop the cache so the next read hits the database. */
  invalidate() {
    this.#cache = null;
  }

  async clear() {
    sqliteDelete(this.#name);
    this.#cache = null;
    return true;
  }
}

/** Convenience for the one-off call sites that do not keep a Store around. */
export function readStore(name, fallback = {}) {
  return sqliteGet(name, fallback);
}

export function writeStore(name, value) {
  return sqlitePut(name, value);
}
