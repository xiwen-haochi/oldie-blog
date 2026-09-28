import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JsonStore, setDataDriver, getDataDriver } from '../src/lib/store.js';
import { sqliteAvailable, backendName, databaseFile } from '../src/lib/db.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-db-'));

test('sqlite ships with node, so the option is always there', () => {
  assert.equal(sqliteAvailable(), true, 'node:sqlite should be available on Node 22.5+');
});

test('the driver is json unless you ask for sqlite', () => {
  assert.equal(backendName({}), 'json');
  assert.equal(backendName({ dataDriver: 'json' }), 'json');
  assert.equal(backendName({ dataDriver: 'sqlite' }), 'sqlite');
  assert.equal(backendName({ dataDriver: 'postgres' }), 'json', 'unknown drivers fall back to json');
  setDataDriver('json');
  assert.equal(getDataDriver(), 'json');
});

async function roundTrip(Store, label) {
  const file = path.join(tmp, label + '.json');
  const store = new Store(file, { n: 0 });
  assert.equal(store.backend, getDataDriver());
  assert.deepEqual(store.sync(), { n: 0 }, 'fallback on a cold store');

  const after = await store.update((d) => {
    d.n += 1;
    d.seen = ['x'];
    return d;
  });
  assert.equal(after.n, 1);
  assert.deepEqual(after.seen, ['x']);

  // a second store must see the same data
  const reader = new Store(file, { n: 0 });
  assert.equal(reader.sync().n, 1, label + ': the write was not visible to a fresh store');
  return store;
}

test('the json backend round-trips', async () => {
  setDataDriver('json');
  await roundTrip(JsonStore, 'json-store');
});

test('the sqlite backend round-trips and survives a restart', async () => {
  setDataDriver('sqlite');
  // the database file persists between runs, so use a fresh key each time
  const label = 'sqlite-store-' + Date.now().toString(36);
  try {
    await roundTrip(JsonStore, label);
    const rows = (await import('../src/lib/db.js')).sqliteNames();
    assert.ok(rows.includes(label), 'the row should live in the database: ' + rows.join(', '));
  } finally {
    setDataDriver('json');
  }
});

test('writes are serialised, so concurrent updates do not interleave', async () => {
  setDataDriver('json');
  const store = new JsonStore(path.join(tmp, 'race.json'), { n: 0 });
  await Promise.all(Array.from({ length: 25 }, () => store.update((d) => {
    d.n += 1;
    return d;
  })));
  assert.equal(store.sync().n, 25, 'lost updates');
});

test('invalidate forces the next read to hit storage', async () => {
  setDataDriver('json');
  const file = path.join(tmp, 'inval.json');
  const a = new JsonStore(file, { v: 1 });
  assert.equal(a.sync().v, 1);
  fs.writeFileSync(file, JSON.stringify({ v: 2 }));
  assert.equal(a.sync().v, 1, 'cached');
  a.invalidate();
  assert.equal(a.sync().v, 2, 're-read after invalidate');
});
