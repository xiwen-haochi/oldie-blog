import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createZip, readZip } from '../src/lib/zip.js';

// The restore path moves real directories around, so this suite builds its own
// miniature site in a temp folder and points ROOT/DATA_DIR at it.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-bk-'));
fs.mkdirSync(path.join(sandbox, 'content', 'posts'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'content', 'pages'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'config'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'public', 'uploads'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'content', 'posts', 'a.md'), '---\ntitle: A\n---\n\nA\n');
fs.writeFileSync(path.join(sandbox, 'content', 'posts', 'b.md'), '# B');
fs.writeFileSync(path.join(sandbox, 'content', 'pages', 'about.md'), '# About');
fs.writeFileSync(path.join(sandbox, 'config', 'site.config.json'), '{"title":"sandbox"}');
fs.writeFileSync(path.join(sandbox, 'data', 'settings.json'), '{"title":"sandbox"}');
fs.writeFileSync(path.join(sandbox, 'public', 'uploads', 'p.png'), Buffer.from([1, 2, 3]));

process.env.OLDIE_ROOT = sandbox;
process.env.OLDIE_DATA_DIR = path.join(sandbox, 'data');

const { createBackup, restoreBackup, collectBackupFiles, backupPreview } = await import('../src/lib/backup.js');

test('a backup collects posts, pages, uploads, config and data', () => {
  const names = collectBackupFiles().map((f) => f.name);
  assert.ok(names.includes('content/posts/a.md'), names.join(','));
  assert.ok(names.includes('content/pages/about.md'));
  assert.ok(names.includes('public/uploads/p.png'));
  assert.ok(names.includes('config/site.config.json'));
  assert.ok(names.includes('data/settings.json'));
});

test('leftovers and restore scratch space stay out of the archive', () => {
  fs.writeFileSync(path.join(sandbox, 'data', 'stats.json.123.456.tmp'), 'temp');
  fs.writeFileSync(path.join(sandbox, 'data', 'guestbook.json.migrated-2026-01-01'), 'old copy');
  fs.writeFileSync(path.join(sandbox, 'data', 'oldie.sqlite-wal'), 'wal');
  const names = collectBackupFiles().map((f) => f.name);
  for (const junk of names) {
    assert.ok(!/\.tmp$|\.migrated-|\.sqlite-wal$|\.sqlite-shm$/.test(junk), 'junk in the archive: ' + junk);
  }
});

test('the preview summarises what will be inside', () => {
  const preview = backupPreview();
  assert.ok(preview.files > 0);
  assert.ok(preview.bytes > 0);
  assert.equal(preview.byGroup.content, 3, JSON.stringify(preview.byGroup));
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
  assert.equal(parsed.files.length, count);
  assert.ok(manifest.createdAt);
});

test('a restore puts every file back exactly where it was', async () => {
  const before = collectBackupFiles().map((f) => [f.name, f.data.toString('base64')]);
  const { buffer } = createBackup();

  // nuke the sandbox, then restore from the archive we just made
  fs.rmSync(path.join(sandbox, 'content'), { recursive: true, force: true });
  fs.rmSync(path.join(sandbox, 'config'), { recursive: true, force: true });
  assert.equal(fs.existsSync(path.join(sandbox, 'content')), false);

  const result = await restoreBackup(buffer, { keepUploads: true });
  assert.equal(result.files, before.length, 'everything in the archive should land');
  assert.ok(result.previous.length > 0, 'the old files are set aside, not deleted');

  const after = new Map(collectBackupFiles().map((f) => [f.name, f.data.toString('base64')]));
  for (const [name, data] of before) {
    assert.equal(after.get(name), data, 'mismatch after restore: ' + name);
  }
  assert.ok(fs.existsSync(path.join(sandbox, 'public', 'uploads', 'p.png')), 'uploads were kept');
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

test.after(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  void execFileSync;
});
