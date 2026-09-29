#!/usr/bin/env node
/**
 * Give a fresh clone something to look at.
 *
 *   pnpm seed
 *
 * Two things happen: the bundled sample posts are loaded into the database, and
 * the runtime stores get a believable history. Everything goes through the real
 * store layer, so what the seed writes is exactly what the site reads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTS_DIR, PAGES_DIR } from '../src/lib/paths.js';
import { writes } from './seed-data.mjs';
import { importExistingData } from '../src/lib/migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'scripts', 'sample-content');

// 1. the sample content, staged where the importer expects it ---------------
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

// 2. the runtime stores ----------------------------------------------------
const { Store } = await import('../src/lib/store.js');
for (const [name, data] of Object.entries(writes)) {
  const store = new Store(name, data);
  await store.flush(data);
  console.log('seeded ' + name);
}

// 3. pull the staged markdown into the database ----------------------------
const done = importExistingData({ dataDir: path.join(ROOT, 'data'), root: ROOT });
if (done.migrated.length) console.log('imported ' + done.migrated.map((m) => m.name).join(', '));

// the staged copies have served their purpose
for (const dir of [POSTS_DIR, PAGES_DIR]) {
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (name.endsWith('.md')) fs.rmSync(path.join(dir, name), { force: true });
  }
}

console.log('');
console.log('  ' + copied + ' sample documents, a guestbook, subscribers and a hit counter,');
console.log('  all in data/oldie.sqlite. Run \'pnpm start\' and open the site.');
console.log('');
