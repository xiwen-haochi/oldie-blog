import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createZip, readZip, safeEntryPath } from './zip.js';
import { ROOT, POSTS_DIR, PAGES_DIR, DATA_DIR, UPLOAD_DIR, CONFIG_DIR } from './paths.js';
import { sqliteStats, sqliteGet, sqliteNames, databaseFile, backendName } from './db.js';

const IGNORE = /^(\.git|node_modules|\.cache|coverage|\.DS_Store|\.gitkeep|.*\.log$|.*\.tmp$|.*\.sqlite-wal$|.*\.sqlite-shm$|.*\.migrated-.*|.*\.before-restore-.*|\.restore-staging-.*)/;

/** Files worth putting in a backup, relative to the project root. */
export function collectBackupFiles() {
  const out = [];
  const roots = [
    { dir: path.join(ROOT, 'content'), label: 'content' },
    { dir: DATA_DIR, label: 'data' },
    { dir: UPLOAD_DIR, label: 'public/uploads' },
    { dir: CONFIG_DIR, label: 'config' },
  ];

  const walk = (dir, label, depth) => {
    if (depth > 4) return;
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const rel = label + '/' + entry.name;
      if (IGNORE.test(entry.name) || IGNORE.test(rel)) continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        out.push({ name: rel, data: fs.readFileSync(path.join(dir, entry.name)) });
      } catch {
        /* skip anything we cannot read (a file being rewritten right now) */
      }
    }
  };

  for (const root of roots) walk(root.dir, root.label, 0);
  return out;
}
/** What a backup would contain, for the admin screen. */
export function backupPreview() {
  const files = collectBackupFiles();
  const byGroup = {};
  let bytes = 0;
  for (const file of files) {
    const group = file.name.split('/')[0];
    byGroup[group] = (byGroup[group] || 0) + 1;
    bytes += file.data.length;
  }
  return {
    files: files.length,
    bytes,
    byGroup,
    driver: backendName({ dataDriver: 'sqlite' }),
    database: databaseFile(),
  };
}

/**
 * Build the archive. Manifest first so an import can describe itself.
 */
export function createBackup() {
  const files = collectBackupFiles();
  const now = new Date();
  const manifest = {
    format: 'oldie-blog-backup',
    version: 1,
    createdAt: now.toISOString(),
    node: process.version,
    storage: backendName({ dataDriver: 'sqlite' }),
    files: files.map((f) => f.name),
  };
  const entries = [
    { name: 'MANIFEST.json', data: JSON.stringify(manifest, null, 2) + '\n', mtime: now },
    ...files,
  ];
  return { buffer: createZip(entries), manifest, count: files.length };
}

/**
 * Restore from an uploaded archive.
 *
 * Everything is written to a staging folder first, then swapped in, so a
 * corrupt archive can never leave you with half a site.
 *
 * @param {Buffer} buffer
 * @param {{ keepUploads?: boolean }} [opts]
 */
export async function restoreBackup(buffer, opts = {}) {
  const entries = readZip(buffer);
  if (!entries.length) throw new Error('压缩包是空的');

  const manifestEntry = entries.find((e) => e.name === 'MANIFEST.json');
  if (!manifestEntry) throw new Error('这不像 oldie-blog 的备份（缺少 MANIFEST.json）');
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch {
    throw new Error('MANIFEST.json 读不出来');
  }
  if (manifest.format !== 'oldie-blog-backup') throw new Error('备份格式不认识：' + manifest.format);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const staging = path.join(ROOT, '.restore-staging-' + stamp);
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });

  const written = [];
  for (const entry of entries) {
    const rel = safeEntryPath(entry.name);
    if (rel === 'MANIFEST.json') continue;
    const target = path.join(staging, rel);
    if (!target.startsWith(staging)) throw new Error('不安全的路径: ' + entry.name);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.data);
    written.push(rel);
  }

  // move what is currently there out of the way, then swap the archive in
  const groups = {
    content: POSTS_DIR.slice(0, 0) || null,
  };
  void groups;
  const moves = [
    { from: path.join(ROOT, 'content'), label: 'content' },
    { from: DATA_DIR, label: 'data' },
    { from: UPLOAD_DIR, label: 'uploads' },
    { from: CONFIG_DIR, label: 'config' },
  ];
  const backups = [];
  const present = new Set(written.map((name) => name.split('/')[0] === 'public' ? 'uploads' : name.split('/')[0]));
  for (const move of moves) {
    if (!fs.existsSync(move.from)) continue;
    if (!present.has(move.label)) continue;   // the archive has nothing for this group
    if (move.label === 'uploads' && opts.keepUploads) continue;
    const aside = path.join(ROOT, '.before-restore-' + stamp, move.label);
    await fsp.mkdir(path.dirname(aside), { recursive: true });
    await fsp.rename(move.from, aside);
    backups.push(path.relative(ROOT, aside));
  }

  for (const entry of written) {
    const target = path.join(ROOT, entry);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(path.join(staging, entry), target);
  }
  await fsp.rm(staging, { recursive: true, force: true });

  return {
    files: written.length,
    createdAt: manifest.createdAt,
    previous: backups,
  };
}

export { sqliteStats, sqliteGet, sqliteNames };
