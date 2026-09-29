import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One database for the whole site, so a test that pointed at the real data dir
// would be reading and writing the operator's own content. Isolate first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-db-'));
process.env.OLDIE_DATA_DIR = path.join(tmp, 'data');
process.env.OLDIE_ROOT = tmp;

const { Store } = await import('../src/lib/store.js');
const { sqliteAvailable, requireSqlite, databaseFile, sqliteNames, sqliteKeysWith, sqliteDelete, sqliteClose } =
  await import('../src/lib/db.js');

test.after(() => {
  sqliteClose();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the OS will get it */ }
});

test('sqlite ships with node, so there is nothing to install', () => {
  assert.equal(sqliteAvailable(), true, 'node:sqlite should be available on Node 22.5+');
  assert.equal(requireSqlite(), true);
});

test('the whole site lives in one file', () => {
  assert.equal(databaseFile(), path.join(tmp, 'data', 'oldie.sqlite'));
  const store = new Store('where', {});
  assert.equal(store.backend, 'sqlite');
  assert.equal(store.where(), databaseFile());
});

test('a store round-trips and a fresh one sees the write', async () => {
  const name = 'rt-' + Date.now().toString(36);
  const store = new Store(name, { n: 0 });
  assert.deepEqual(store.sync(), { n: 0 }, 'fallback on a cold store');

  const after = await store.update((d) => {
    d.n += 1;
    d.seen = ['x'];
    return d;
  });
  assert.equal(after.n, 1);
  assert.deepEqual(after.seen, ['x']);

  const reader = new Store(name, { n: 0 });
  assert.equal(reader.sync().n, 1, 'the write was not visible to a fresh store');
  assert.ok(sqliteNames().includes(name), 'the row should live in the database');
  sqliteDelete(name);
});

test('stores do not see each other', () => {
  const a = new Store('separate-a', { who: 'a' });
  const b = new Store('separate-b', { who: 'b' });
  assert.equal(a.sync().who, 'a');
  assert.equal(b.sync().who, 'b');
  sqliteDelete('separate-a');
  sqliteDelete('separate-b');
});

test('writes are serialised, so concurrent updates do not interleave', async () => {
  const name = 'race-' + Date.now().toString(36);
  const store = new Store(name, { n: 0 });
  await Promise.all(Array.from({ length: 25 }, () => store.update((d) => {
    d.n += 1;
    return d;
  })));
  assert.equal(store.sync().n, 25, 'lost updates');
  assert.equal(new Store(name, {}).sync().n, 25, 'and the total did not reach the database');
  sqliteDelete(name);
});

test('invalidate forces the next read to hit storage', async () => {
  const name = 'inv-' + Date.now().toString(36);
  const a = new Store(name, { v: 1 });
  await a.flush({ v: 1 });
  const b = new Store(name, { v: 0 });
  assert.equal(b.sync().v, 1);
  await a.flush({ v: 2 });
  b.invalidate();
  assert.equal(b.sync().v, 2, 'invalidate did not re-read');
  sqliteDelete(name);
});

test('clear removes a store entirely', async () => {
  const name = 'clear-' + Date.now().toString(36);
  const store = new Store(name, { v: 1 });
  await store.flush({ v: 1 });
  assert.ok(sqliteNames().includes(name));
  await store.clear();
  assert.equal(sqliteNames().includes(name), false);
});

test('articles are namespaced so a slug cannot collide with a store name', () => {
  const stamp = Date.now().toString(36);
  const write = (prefix, slug) => {
    const key = prefix + slug;
    const s = new Store(key, { slug });
    s.flush({ slug });
    return key;
  };
  const post = write('post:', 'hello-' + stamp);
  const page = write('page:', 'hello-' + stamp);
  assert.deepEqual(sqliteKeysWith('post:'), ['hello-' + stamp]);
  assert.deepEqual(sqliteKeysWith('page:'), ['hello-' + stamp]);
  assert.notEqual(post, page);
  sqliteDelete(post);
  sqliteDelete(page);
});

test('a prefix listing escapes LIKE wildcards in a slug', () => {
  const key = 'weird:100%_pure';
  new Store(key, {}).flush({ ok: true });
  assert.deepEqual(sqliteKeysWith('weird:'), ['100%_pure'], 'the % and _ leaked into the LIKE pattern');
  sqliteDelete(key);
});
