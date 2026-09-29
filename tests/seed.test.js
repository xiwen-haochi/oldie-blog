import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Stats } from '../src/lib/stats.js';
import { writes } from '../scripts/seed-data.mjs';

function statsFrom(doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-stats-'));
  const file = path.join(dir, 'stats.json');
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return { stats: new Stats({ file }), file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// The seed writes a store by hand. When its shape drifts from what Stats
// expects, the counter renders "[object Object]1" instead of a number — the
// kind of thing only a screenshot catches, long after a test would.
test('the seeded stats match the shape Stats reads', async () => {
  const { stats, file, cleanup } = statsFrom(writes.stats);
  try {
    await stats.hit({ path: '/', visitorId: 'probe', count: true });
    const s = stats.summary();

    assert.equal(typeof s.today, 'number', 'days[day] must be a plain number, not an object');
    assert.ok(Number.isFinite(s.today), 'today must be a real count, got: ' + s.today);
    assert.ok(Number.isFinite(s.total), 'total must be a real count, got: ' + s.total);
    assert.ok(Number.isFinite(s.unique), 'unique visitors must be a real count, got: ' + s.unique);

    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('[object Object]'), 'the seed wrote a value the counter cannot add to');
  } finally {
    cleanup();
  }
});

test('every seeded day is a number, not a nested object', () => {
  for (const [day, value] of Object.entries(writes.stats.days || {})) {
    assert.equal(typeof value, 'number', 'days[' + day + '] should be a count, got ' + typeof value);
  }
});

test('every seeded path count is a number', () => {
  for (const [p, value] of Object.entries(writes.stats.paths || {})) {
    assert.equal(typeof value, 'number', 'paths[' + p + '] should be a count, got ' + typeof value);
  }
});

test('a day counter keeps counting after the seeded history', async () => {
  const { stats, cleanup } = statsFrom(writes.stats);
  try {
    const before = stats.summary().today;
    await stats.hit({ path: '/', visitorId: 'a', count: true });
    await stats.hit({ path: '/', visitorId: 'b', count: true });
    assert.equal(stats.summary().today, before + 2, 'the day counter must increment, not stringify');
  } finally {
    cleanup();
  }
});

test('the seeded guestbook entries have the fields Community reads', () => {
  const entries = writes.guestbook.entries || [];
  assert.ok(entries.length > 0, 'the seed should ship some entries');
  for (const entry of entries) {
    assert.equal(typeof entry.id, 'number', 'entry needs a numeric id');
    assert.equal(typeof entry.name, 'string', 'entry needs a name');
    assert.equal(typeof entry.message, 'string', 'entry needs a message');
    assert.ok(
      entry.target === 'guestbook' || entry.target.startsWith('post:'),
      'unexpected target: ' + entry.target
    );
    assert.ok(['approved', 'pending', 'spam'].includes(entry.status), 'unexpected status: ' + entry.status);
  }
});
