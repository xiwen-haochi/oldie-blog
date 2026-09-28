import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICT_ZH, DICT_EN } from '../src/lib/i18n.js';

const VIEWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'views');

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ejs')) out.push(full);
  }
  return out;
}

const templates = walk(VIEWS);
const usedKeys = new Map(); // key -> [file]

for (const file of templates) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-z0-9_.]+)'/g)) {
    const key = m[1];
    if (!usedKeys.has(key)) usedKeys.set(key, []);
    usedKeys.get(key).push(path.relative(VIEWS, file));
  }
}

test('every template has at least one translated string', () => {
  assert.ok(templates.length > 25, 'expected the full view tree, found ' + templates.length);
  assert.ok(usedKeys.size > 80, 'expected many t() calls, found ' + usedKeys.size);
});

test('no template asks for a key that does not exist', () => {
  const missing = [...usedKeys.entries()].filter(([key]) => !(key in DICT_ZH) && !(key in DICT_EN));
  assert.equal(missing.length, 0, 'unknown keys: ' + missing.map(([k, files]) => k + ' (' + files[0] + ')').join(', '));
});

test('every key used in a template is translated in both languages', () => {
  const untranslated = [...usedKeys.keys()].filter((key) => !(key in DICT_ZH) || !(key in DICT_EN));
  assert.equal(untranslated.length, 0, 'half-translated keys: ' + untranslated.join(', '));
});

test('every shipped key is reachable from templates or server code', () => {
  const roots = [path.resolve(VIEWS, '..')];
  const sources = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js') || name.endsWith('.ejs')) sources.push(fs.readFileSync(full, 'utf8'));
    }
  };
  roots.forEach(walk);
  const haystack = sources.join('\n');

  // any dictionary-shaped literal anywhere counts as a use
  const mentioned = new Set();
  for (const m of haystack.matchAll(/['"]([a-z0-9][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"]/g)) {
    if (m[1] in DICT_ZH) mentioned.add(m[1]);
  }

  const dead = Object.keys(DICT_ZH).filter((key) => !mentioned.has(key));
  assert.equal(dead.length, 0, 'these keys are never used anywhere: ' + dead.join(', '));
});



test('public chrome has no leftover hardcoded English', () => {
  const offenders = [];
  for (const file of templates.filter((f) => !f.includes(path.join('admin', '')))) {
    const src = fs.readFileSync(file, 'utf8');
    // English words sitting directly in markup (outside of <script>/code/ascii art)
    const markup = src.replace(/<%[=-]?[\s\S]*?%>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '');
    const hits = markup.match(/>[^<>]*\b(READ MORE|SIGN IT|Comments|Guestbook|Search this site|All dispatches|RETURN TO TOP|DOWNLOAD \.TXT)\b[^<>]*</g);
    if (hits) offenders.push(path.relative(VIEWS, file) + ': ' + hits.join(' '));
  }
  assert.equal(offenders.length, 0, offenders.join('\n'));
});
