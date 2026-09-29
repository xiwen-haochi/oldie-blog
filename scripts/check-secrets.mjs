/**
 * Fails the build if anything sensitive is about to be published.
 *
 * The .gitignore already keeps these out, but ignore rules rot: a renamed
 * file, a forced add, or a clone with a different core.excludesFile can all
 * put a password hash into the history. This runs in CI so it is never a
 * surprise, and so a newcomer learns what must stay private.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN = [
  /^data\//,                              // hits, guestbook, subscribers, sessions
  /^config\/admin\.json$/,               // the admin password hash
  /^config\/site\.config\.local\.json$/,
  /^content\/posts\//,                   // your writing is data, not code
  /^content\/pages\//,
  /^\.env$/,
  /^\.env\..+$/,
  /^\.before-restore-/,
  /^\.restore-staging-/,
];

// Placeholders that make the rules above true are fine: they are the point of
// shipping an empty data directory and a documented .env template.
const ALLOWED = new Set([
  'data/.gitkeep',
  'content/posts/.gitkeep',
  'content/pages/.gitkeep',
  'config.default/.gitkeep',
  '.env.example',
]);

const banned = (rel) => !ALLOWED.has(rel) && FORBIDDEN.some((re) => re.test(rel));

let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
} catch {
  console.log('no git checkout here, nothing to check');
  process.exit(0);
}
const offenders = tracked.filter(banned);

// A second net: the committed config must not carry a live secret either.
const configPath = path.join(ROOT, 'config', 'site.config.json');
if (existsSync(configPath)) {
  const text = readFileSync(configPath, 'utf8');
  const secretish = text.match(/"(apiKey|secretAccessKey|password|accessToken)" *: *"[^"]{8,}"/g);
  if (secretish) {
    console.error('config/site.config.json contains what looks like a live secret:');
    for (const line of secretish) console.error('   ' + line);
    process.exit(1);
  }
}

if (offenders.length) {
  console.error('these files are tracked but must never be published:');
  for (const f of offenders) console.error('   ' + f);
  console.error('');
  console.error('remove them with: git rm --cached <file>');
  process.exit(1);
}

console.log('ok: ' + tracked.length + ' tracked files, none of them sensitive');
