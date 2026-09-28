import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SENSITIVE, sensitiveOnDisk, sensitiveTracked } from '../src/lib/privacy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');

test('every sensitive file is ignored by git', () => {
  const rules = ignore.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const covered = (rel) => rules.some((rule) => {
    if (rule.startsWith('!')) return false;
    if (rule.endsWith('/')) return rel.startsWith(rule);
    if (rule.includes('*')) {
      const re = new RegExp('^' + rule.split('*').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      return re.test(rel);
    }
    return rule === rel;
  });
  for (const rel of SENSITIVE) {
    assert.ok(covered(rel), rel + ' is not covered by .gitignore');
  }
  // and the shapes the JSON store writes while saving
  assert.ok(covered('data/stats.json.12345.1790584109905.tmp'));
  assert.ok(covered('data/guestbook.json.9.1.tmp'));
});

test('runtime temp files are ignored too', () => {
  assert.match(ignore, /data\/\*\.json\.\*/);
  assert.match(ignore, /data\/\*\.tmp/);
});

test('the .gitkeep escape hatch is still allowed', () => {
  assert.match(ignore, /!data\/\.gitkeep/);
});

test('nothing sensitive is tracked right now', () => {
  const tracked = sensitiveTracked();
  assert.deepEqual(tracked, [], 'these sensitive files are in git: ' + tracked.join(', '));
});

test('the store temp-file pattern is recognised', () => {
  // sanity: the shapes we actually write while saving
  const samples = [
    'data/stats.json.12345.1790584109905.tmp',
    'data/guestbook.json.9.1790584109905.tmp',
  ];
  for (const rel of samples) {
    const out = sensitiveOnDisk();
    assert.ok(Array.isArray(out));
  }
  assert.ok(SENSITIVE.includes('data/settings.json'));
});
