import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createZip, readZip } from '../src/lib/zip.js';

// The archive is built from the database now, so this suite gets its own.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-bk-'));
process.env.OLDIE_ROOT = sandbox;
process.env.OLDIE_DATA_DIR = path.join(sandbox, 'data');

const { createBackup, restoreBackup, collectBackupFiles, backupPreview, exportDatabase } =
  await import('../src/lib/backup.js');
const { saveDoc, deleteDoc, readDoc, normaliseFields, listDocs } = await import('../src/lib/writer.js');
const { sqliteGet, sqlitePut, sqliteClose } = await import('../src/lib/db.js');

fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'public', 'uploads'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'config', 'site.config.json'), '{"title":"sandbox"}');
fs.writeFileSync(path.join(sandbox, 'public', 'uploads', 'p.png'), Buffer.from([1, 2, 3]));

const seed = async () => {
  for (const [title, body] of [['A', 'A\n'], ['B', '# B\n']]) {
    await saveDoc({ kind: 'post', slug: '', fields: normaliseFields({ title, date: '2025-06-01' }), body });
  }
  await saveDoc({ kind: 'page', slug: '', fields: normaliseFields({ title: 'About' }), body: '# About\n' });
  sqlitePut('stats', { total: 42 });
  sqlitePut('settings', { title: 'sandbox' });
};
await seed();

test.after(() => {
  sqliteClose();
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* the OS will get it */ }
});

test('a backup carries the database, the articles as markdown, uploads and config', () => {
  const names = collectBackupFiles().map((f) => f.name);
  assert.ok(names.includes('database/oldie.json'), names.join(','));
  assert.ok(names.some((n) => /^content\/posts\/2025-06-01-a\.md$/.test(n)), names.join(','));
  assert.ok(names.some((n) => /^content\/posts\/2025-06-01-b\.md$/.test(n)));
  assert.ok(names.some((n) => /^content\/pages\/.*about\.md$/.test(n)), names.join(','));
  assert.ok(names.includes('public/uploads/p.png'));
  assert.ok(names.includes('config/site.config.json'));
});

test('the exported database round-trips through JSON', () => {
  const doc = exportDatabase();
  assert.equal(doc.stats.total, 42);
  assert.equal(doc.settings.title, 'sandbox');
  assert.equal(doc.post.a.frontMatter.title, 'A');
  assert.equal(doc.page.about.frontMatter.title, 'About');
  assert.ok(doc.post.a.slug === 'a');
});

test('the markdown in the archive is real front matter, not a database dump', () => {
  const file = collectBackupFiles().find((f) => /content\/posts\/2025-06-01-a\.md$/.test(f.name));
  const text = file.data.toString('utf8');
  assert.match(text, /^---\ntitle: A\n/);
  assert.match(text, /\n---\n/);
});

test('leftovers and restore scratch space stay out of the archive', () => {
  fs.writeFileSync(path.join(sandbox, 'data', 'stats.json.123.456.tmp'), 'temp');
  fs.writeFileSync(path.join(sandbox, 'data', 'oldie.sqlite-wal'), 'wal');
  const names = collectBackupFiles().map((f) => f.name);
  for (const junk of names) {
    assert.ok(!/\.tmp$|\.sqlite-wal$|\.sqlite-shm$|\.before-restore-/.test(junk), 'junk in the archive: ' + junk);
  }
  fs.rmSync(path.join(sandbox, 'data', 'stats.json.123.456.tmp'));
  fs.rmSync(path.join(sandbox, 'data', 'oldie.sqlite-wal'));
});

test('the preview summarises what will be inside', () => {
  const preview = backupPreview();
  assert.ok(preview.files > 0);
  assert.ok(preview.bytes > 0);
  assert.equal(preview.driver, 'sqlite');
  assert.equal(preview.byGroup.content, 3, JSON.stringify(preview.byGroup));
  assert.equal(preview.byGroup.database, 1);
  assert.ok(preview.byGroup.config >= 1);
});

test('a backup is a real zip with a manifest', () => {
  const { buffer, manifest, count } = createBackup();
  assert.ok(buffer.length > 0);
  assert.ok(count > 0);
  const entries = readZip(buffer);
  const manifestEntry = entries.find((e) => e.name === 'MANIFEST.json');
  assert.ok(manifestEntry, 'the manifest is inside the archive');
  const parsed = JSON.parse(manifestEntry.data.toString('utf8'));
  assert.equal(parsed.format, 'oldie-blog-backup');
  assert.equal(parsed.storage, 'sqlite');
  assert.equal(parsed.files.length, count);
  assert.ok(manifest.createdAt);
});

test('a restore brings back everything the database had', async () => {
  const { buffer } = createBackup();
  const beforePosts = listDocs('post').length;

  // destroy the site, then restore
  await deleteDoc({ kind: 'post', slug: 'a' });
  await deleteDoc({ kind: 'post', slug: 'b' });
  sqlitePut('stats', { total: 0 });
  assert.equal(listDocs('post').length, 0, 'the wipe did not happen');

  const result = await restoreBackup(buffer, { keepUploads: true });
  assert.ok(result.files > 0);
  assert.ok(result.previous.length > 0, 'the old database is kept aside, not deleted');
  assert.ok(result.previous.some((p) => p.endsWith('oldie.json')), 'the rollback copy is a file');

  assert.equal(listDocs('post').length, beforePosts, 'the posts did not come back');
  assert.equal(readDoc({ kind: 'post', slug: 'a' }).frontMatter.title, 'A');
  assert.equal(sqliteGet('stats', {}).total, 42, 'the hit counter did not come back');
  assert.equal(sqliteGet('settings', {}).title, 'sandbox');
  assert.ok(fs.existsSync(path.join(sandbox, 'public', 'uploads', 'p.png')), 'uploads were kept');
});

test('a restore is reversible, because the old database is written out', async () => {
  const { buffer } = createBackup();
  const result = await restoreBackup(buffer, { keepUploads: true });
  // the copy belongs to *this* restore; earlier ones may be older snapshots
  const rollbacks = result.previous.filter((p) => p.endsWith('oldie.json'));
  assert.equal(rollbacks.length, 1, 'expected exactly one database rollback: ' + result.previous.join(', '));
  const doc = JSON.parse(fs.readFileSync(path.join(sandbox, rollbacks[0]), 'utf8'));
  assert.equal(doc.post.a.frontMatter.title, 'A', 'the rollback copy is a real database dump');
  assert.equal(doc.stats.total, 42);
});
test('a foreign or corrupt archive is refused', async () => {
  const notOurs = createZip([{ name: 'hello.txt', data: 'nope' }]);
  await assert.rejects(() => restoreBackup(notOurs), /MANIFEST/);
  await assert.rejects(() => restoreBackup(Buffer.from('garbage')), /zip/);
});

test('a zip-slip archive cannot escape the project', async () => {
  const hostile = createZip([
    { name: 'MANIFEST.json', data: JSON.stringify({ format: 'oldie-blog-backup', version: 1, createdAt: new Date().toISOString(), files: [] }) },
    { name: '../../../../tmp/evil.md', data: 'gotcha' },
  ]);
  await assert.rejects(() => restoreBackup(hostile), /不安全/);
});
