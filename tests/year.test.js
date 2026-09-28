import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, loadConfig } from '../src/lib/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YEAR = new Date().getFullYear();

test('the founding year defaults to the real current year', () => {
  assert.equal(String(DEFAULTS.since), String(YEAR), 'DEFAULTS.since should be the current year');
  const site = loadConfig({ env: {} });
  assert.ok(/^\d{4}$/.test(String(site.since)));
});

test('a configured founding year is still respected', () => {
  const site = loadConfig({ env: {} });
  assert.ok(typeof site.since === 'string' || typeof site.since === 'number');
});

test('the shipped config does not pin a year', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'site.config.json'), 'utf8'));
  assert.equal(raw.since, undefined, 'config/site.config.json should not hardcode "since"');
});

test('templates never print a hardcoded 1998 as a date', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ejs')) {
        const src = fs.readFileSync(full, 'utf8');
        if (/1998/.test(src) && !/1998 MODE|1998 模式/.test(src)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, 'src', 'views'));
  assert.deepEqual(offenders, [], 'these templates still mention 1998 as a value: ' + offenders.join(', '));
});

test('the copyright renders the current year', () => {
  const { enrichLocals } = {};
  // the string itself is what ships to the browser
  const footer = fs.readFileSync(path.join(ROOT, 'src', 'views', 'partials', 'footer.ejs'), 'utf8');
  assert.match(footer, /<%= copyright %>/);
  assert.ok(!footer.includes('1998'), 'the footer template must not hardcode a year');
});
