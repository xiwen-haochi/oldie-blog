#!/usr/bin/env node
/**
 * Give a fresh clone something to look at.
 *
 *   pnpm seed
 *
 * Two things happen: the bundled sample posts are copied into content/, and the
 * runtime stores get a believable history. Everything goes through the real store
 * layer, so it works whichever backend is configured (JSON files or SQLite).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, POSTS_DIR, PAGES_DIR } from '../src/lib/paths.js';
import { writes } from './seed-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'scripts', 'sample-content');

// 1. sample content -------------------------------------------------------
let copied = 0;
for (const [from, to] of [[path.join(SAMPLES, 'posts'), POSTS_DIR], [path.join(SAMPLES, 'pages'), PAGES_DIR]]) {
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (!name.endsWith('.md')) continue;
    fs.copyFileSync(path.join(from, name), path.join(to, name));
    copied++;
  }
}

// 2. the runtime stores, through the store layer so sqlite works too ------
// imported dynamically: the driver is read from the config at import time.
const { JsonStore, setDataDriver } = await import('../src/lib/store.js');
const { loadConfig } = await import('../src/lib/config.js');
const site = loadConfig();
setDataDriver(site.dataDriver);

fs.mkdirSync(DATA_DIR, { recursive: true });
for (const [name, data] of Object.entries(writes)) {
  const store = new JsonStore(path.join(DATA_DIR, name + '.json'), data);
  await store.flush(data);
  console.log('seeded ' + name);
}

console.log('');
console.log('  ' + copied + ' sample posts, guestbook, subscribers and a hit counter.');
console.log('  Run \'pnpm start\' and open the site.');
console.log('');
