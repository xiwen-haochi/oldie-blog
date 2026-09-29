/* tests/migrate.test.js
 *
 * The creation stamp on a document. Posts written before that field existed
 * have none, and without a backfill every same-day pair falls back to the
 * title -- which is how three articles written in one afternoon came back
 * sorted by the alphabet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-migrate-'));
process.env.OLDIE_DATA_DIR = path.join(tmp, 'data');
process.env.OLDIE_ROOT = tmp;

const { sqliteGet, sqlitePut, sqliteWrittenAt, sqliteClose } = await import('../src/lib/db.js');
const { importExistingData } = await import('../src/lib/migrate.js');

test.after(() => {
  sqliteClose();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the OS will get it */ }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const boot = () => importExistingData({ dataDir: path.join(tmp, 'data'), root: null });

test('a document can report when its row was last written', async () => {
  sqlitePut('post:probe', { kind: 'post', slug: 'probe', frontMatter: {}, body: 'x' });
  assert.match(String(sqliteWrittenAt('post:probe')), /^\d{4}-\d{2}-\d{2}T/, 'no row timestamp to read');
  assert.equal(sqliteWrittenAt('post:nothing-here'), null);
});

test('posts that predate createdAt get one, in the order they were saved', async () => {
  sqlitePut('post:older', { kind: 'post', slug: 'older', frontMatter: { title: 'older', date: '2026-09-29' }, body: 'a' });
  await wait(5);
  sqlitePut('post:newer', { kind: 'post', slug: 'newer', frontMatter: { title: 'newer', date: '2026-09-29' }, body: 'b' });
  assert.equal(sqliteGet('post:older').createdAt, undefined, 'a stored document starts without a stamp');

  const done = await boot();

  const older = sqliteGet('post:older').createdAt;
  const newer = sqliteGet('post:newer').createdAt;
  assert.ok(older && newer, 'the backfill left a document unstamped');
  assert.ok(new Date(newer) > new Date(older), 'the later-written post must come out later: ' + older + ' vs ' + newer);
  assert.ok(done.stamped >= 2, 'the boot should report how many it stamped, saw ' + done.stamped);
});

test('a document that already has a stamp is never touched', async () => {
  sqlitePut('post:stamped', {
    kind: 'post', slug: 'stamped', body: 'c', createdAt: '2020-01-01T00:00:00.000Z',
    frontMatter: { title: 'stamped', date: '2020-01-01' },
  });
  await boot();
  assert.equal(sqliteGet('post:stamped').createdAt, '2020-01-01T00:00:00.000Z');
});

test('booting twice does not move a stamp', async () => {
  const before = sqliteGet('post:newer').createdAt;
  await wait(5);
  await boot();
  assert.equal(sqliteGet('post:newer').createdAt, before, 'the second boot moved the creation time');
});
