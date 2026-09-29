/**
 * One-time migration: on a fresh install, if the JSON files are still lying
 * around and the database is empty, move them in so switching the default
 * driver to sqlite never costs anybody their guestbook or hit count.
 */
import fs from 'node:fs';
import path from 'node:path';
import { backendName, sqlitePut, sqliteNames, sqliteGet } from './db.js';

export function migrateJsonToSqlite({ dataDir, stores = ['stats', 'guestbook', 'subscribers', 'sessions'], force = false } = {}) {
  if (backendName({ dataDriver: 'sqlite' }) !== 'sqlite') return { migrated: [], skipped: true };
  const existing = new Set(sqliteNames());
  const migrated = [];
  for (const name of stores) {
    const file = path.join(dataDir, name + '.json');
    if (!fs.existsSync(file)) continue;
    if (existing.has(name) && !force) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      sqlitePut(name, doc);
      const stamp = new Date().toISOString();
      const backup = file + '.migrated-' + stamp.slice(0, 10);
      fs.renameSync(file, backup);
      migrated.push({ name, backup });
    } catch {
      /* leave a broken file alone rather than losing it */
    }
  }
  return { migrated, skipped: false };
}

/** Move a store back out to a JSON file (escape hatch for debugging). */
export function exportStoreToJson(dataDir, name) {
  if (backendName({ dataDriver: 'sqlite' }) !== 'sqlite') return null;
  const file = path.join(dataDir, name + '.json');
  fs.writeFileSync(file, JSON.stringify(sqliteGet(name, {}), null, 2) + '\n');
  return file;
}
