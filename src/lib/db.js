/**
 * The storage engine: one SQLite file, data/oldie.sqlite, holding everything —
 * settings, articles, hit counts, guestbook, subscribers, sessions.
 *
 * There is no second backend. One file means one place to back up, one place to
 * look when something is wrong, and no "which driver was I on" questions.
 * SQLite is node:sqlite, which ships with Node 22.5+, so the project still
 * installs with zero dependencies and nothing to compile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DATA_DIR } from './paths.js';

let sqliteModule = null;
let sqliteChecked = false;

function loadSqlite() {
  if (sqliteChecked) return sqliteModule;
  sqliteChecked = true;
  try {
    // node:sqlite exists from Node 22.5; it is experimental but stable enough
    // for a key/value store, and it needs no npm package at all.
    // eslint-disable-next-line no-undef
    sqliteModule = createRequire(import.meta.url)('node:sqlite');
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

export function sqliteAvailable() {
  return Boolean(loadSqlite() && loadSqlite().DatabaseSync);
}

/** Fail loudly and usefully rather than silently writing nothing. */
export function requireSqlite() {
  if (sqliteAvailable()) return true;
  throw new Error(
    'This site stores everything in SQLite (node:sqlite), which ships with ' +
    'Node 22.5 and later. Run it on Node 22.5+ — see .nvmrc — or upgrade.'
  );
}

export function databaseFile() {
  return path.join(DATA_DIR, 'oldie.sqlite');
}

/* --------------------------------------------------------------- sqlite */

let db = null;

function open() {
  if (db) return db;
  requireSqlite();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new (loadSqlite().DatabaseSync)(databaseFile());
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS stores (name TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT)');
  return db;
}

export function sqliteGet(name, fallback) {
  const row = open().prepare('SELECT doc FROM stores WHERE name = ?').get(name);
  if (!row) return structuredClone(fallback);
  try {
    return JSON.parse(row.doc);
  } catch {
    return structuredClone(fallback);
  }
}

export function sqlitePut(name, value) {
  open()
    .prepare('INSERT INTO stores (name, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at')
    .run(name, JSON.stringify(value), new Date().toISOString());
  return value;
}

/**
 * When the row was last written, which is the only trace of creation time a
 * document that predates the createdAt field leaves behind.
 */
export function sqliteWrittenAt(name) {
  const row = open().prepare('SELECT updated_at FROM stores WHERE name = ?').get(name);
  return (row && row.updated_at) || null;
}

export function sqliteNames() {
  return open().prepare('SELECT name FROM stores').all().map((r) => r.name);
}

/** Every key under a namespace, without the prefix. Articles use post:/page:. */
export function sqliteKeysWith(prefix) {
  return open()
    .prepare('SELECT name FROM stores WHERE name LIKE ? ESCAPE ?')
    .all(escapeLike(prefix) + '%', '\\')
    .map((r) => r.name.slice(prefix.length));
}

export function sqliteDeleteWhere(prefix) {
  return open()
    .prepare('DELETE FROM stores WHERE name LIKE ? ESCAPE ?')
    .run(escapeLike(prefix) + '%', '\\').changes;
}

export function sqliteDelete(name) {
  open().prepare('DELETE FROM stores WHERE name = ?').run(name);
  return true;
}

export function sqliteStats() {
  const conn = open();
  const rows = conn.prepare('SELECT name, updated_at FROM stores').all();
  const pageSize = conn.prepare('PRAGMA page_count').get();
  return { stores: rows.length, rows, pages: Object.values(pageSize)[0] };
}

export function sqliteClose() {
  if (db) {
    try { db.close(); } catch { /* already closed */ }
    db = null;
  }
}

/** LIKE treats % and _ as wildcards; a slug can contain neither, but be safe. */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => '\\' + c);
}
