/**
 * Storage backend for the runtime data (hit counter, guestbook, sessions,
 * settings overrides).
 *
 *   json    – one file per store. Human readable, git-ignorable, zero setup.
 *   sqlite – one file for everything, real transactions, survives power cuts.
 *
 * SQLite uses node:sqlite, which ships with Node 22.5+ — still no dependency.
 * The JSON store stays the default so a fresh clone needs nothing at all.
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

export function backendName(config) {
  const want = String(config?.dataDriver || 'json').toLowerCase();
  if (want === 'sqlite' && sqliteAvailable()) return 'sqlite';
  return 'json';
}

export function databaseFile() {
  return path.join(DATA_DIR, 'oldie.sqlite');
}

/* --------------------------------------------------------------- sqlite */

let db = null;

function open() {
  if (db) return db;
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

export function sqliteNames() {
  return open().prepare('SELECT name FROM stores').all().map((r) => r.name);
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
