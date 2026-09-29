import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createZip, readZip, safeEntryPath } from './zip.js';
import { ROOT, DATA_DIR, UPLOAD_DIR, CONFIG_DIR } from './paths.js';
import { sqliteStats, sqliteGet, sqliteNames, databaseFile, sqlitePut, sqliteDelete, sqliteDeleteWhere } from './db.js';
import { listDocs, fileNameFor, frontMatter } from './writer.js';

const IGNORE = /^(\.git|node_modules|\.cache|coverage|\.DS_Store|\.gitkeep|.*\.log$|.*\.tmp$|.*\.sqlite-wal$|.*\.sqlite-shm$|.*\.migrated-.*|.*\.before-restore-.*|\.restore-staging-.*)/;

const walkFiles = (dir, label, out, depth = 0) => {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = label + '/' + entry.name;
    if (IGNORE.test(entry.name) || IGNORE.test(rel)) continue;
    if (entry.isDirectory()) {
      walkFiles(path.join(dir, entry.name), rel, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      out.push({ name: rel, data: fs.readFileSync(path.join(dir, entry.name)) });
    } catch {
      /* skip anything we cannot read (a file being rewritten right now) */
    }
  }
  return out;
};

/**
 * Everything a restore needs, in one archive.
 *
 * The database is exported twice on purpose: once as one JSON document, which
 * is what a restore reads back, and once as real Markdown files under
 * content/, so the backup stays readable and greppable by a human.
 */
export function collectBackupFiles() {
  const out = [];

  out.push({
    name: 'database/oldie.json',
    data: Buffer.from(JSON.stringify(exportDatabase(), null, 2) + '\n', 'utf8'),
  });

  for (const kind of ['post', 'page']) {
    for (const doc of listDocs(kind)) {
      const dir = kind === 'post' ? 'content/posts' : 'content/pages';
      out.push({
        name: dir + '/' + fileNameFor(doc.frontMatter),
        data: Buffer.from(frontMatter(doc.frontMatter, doc.body), 'utf8'),
      });
    }
  }

  walkFiles(UPLOAD_DIR, 'public/uploads', out);
  walkFiles(CONFIG_DIR, 'config', out);
  return out;
}

/** The whole database as plain objects, keyed exactly as it is stored. */
export function exportDatabase() {
  const out = {};
  for (const name of sqliteNames()) {
    if (name.includes(':')) {
      const cut = name.indexOf(':');
      const namespace = name.slice(0, cut);
      (out[namespace] = out[namespace] || {})[name.slice(cut + 1)] = sqliteGet(name, null);
    } else {
      out[name] = sqliteGet(name, null);
    }
  }
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
    driver: 'sqlite',
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
    storage: 'sqlite',
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

  // Millisecond precision on purpose: two restores in the same minute used to
  // produce the same .before-restore-* folder, and the second one collided.
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '');
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

  // The database is replaced wholesale, and the old one is kept as a file so a
  // restore is itself reversible.
  const databaseEntry = written.indexOf('database/oldie.json');
  const backups = [];
  if (databaseEntry >= 0) {
    const doc = JSON.parse(fs.readFileSync(path.join(staging, 'database/oldie.json'), 'utf8'));
    const aside = path.join(ROOT, '.before-restore-' + stamp);
    await fsp.mkdir(aside, { recursive: true });
    const previous = path.join(aside, 'oldie.json');
    fs.writeFileSync(previous, JSON.stringify(exportDatabase(), null, 2) + '\n', 'utf8');
    backups.push(path.relative(ROOT, previous));

    for (const name of Object.keys(doc)) {
      const value = doc[name];
      // post:/page: are namespaces: a map of slug -> document
      const isNamespace = value && typeof value === 'object' && !Array.isArray(value)
        && Object.values(value).some((v) => v && typeof v === 'object' && 'slug' in v);
      if (isNamespace) {
        sqliteDeleteWhere(name + ':');
        for (const [slug, doc2] of Object.entries(value)) sqlitePut(name + ':' + slug, doc2);
        continue;
      }
      sqliteDelete(name);
      if (value !== null && value !== undefined) sqlitePut(name, value);
    }
  }

  // uploads and the config file still live on disk
  const moves = [
    { from: UPLOAD_DIR, label: 'public/uploads' },
    { from: CONFIG_DIR, label: 'config' },
  ];
  const present = new Set(written.map((n) => n.split('/')[0] === 'public' ? 'public/uploads' : n.split('/')[0]));
  for (const move of moves) {
    if (!fs.existsSync(move.from)) continue;
    if (!present.has(move.label)) continue;
    if (move.label === 'public/uploads' && opts.keepUploads) continue;
    const aside = path.join(ROOT, '.before-restore-' + stamp, move.label);
    await fsp.mkdir(path.dirname(aside), { recursive: true });
    await fsp.rename(move.from, aside);
    backups.push(path.relative(ROOT, aside));
  }

  for (const entry of written) {
    if (entry === 'database/oldie.json') continue;
    if (entry.split('/')[0] === 'content') continue;   // the .md files are only for humans
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