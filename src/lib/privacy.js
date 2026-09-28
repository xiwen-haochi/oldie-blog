/**
 * What must never end up in a public repository, and a best-effort check that
 * it has not. Called on boot; it warns loudly rather than blocking, because a
 * missing git repo is perfectly normal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DATA_DIR, CONFIG_DIR } from './paths.js';

export const SENSITIVE = [
  'config/admin.json',         // scrypt password hash + username
  'data/settings.json',        // may hold S3 keys and the AI api key
  'data/stats.json',           // hit counter + salted visitor hashes
  'data/guestbook.json',      // visitor names, e-mails, IPs
  'data/subscribers.json',    // e-mail addresses
  'data/session-secret.json', // session signing secret
  '.env',
];

/* The JSON store writes <name>.json.<pid>.<ts>.tmp while saving; those hold
   the same personal data as the file they replace, so they count too. */
const SENSITIVE_GLOBS = [
  /^data\/.*\.json\.[0-9]+\.[0-9]+\.tmp$/,
  /^data\/.*\.tmp$/,
  /^data\/.*\.json\.bak$/,
];

function isSensitive(rel) {
  if (SENSITIVE.includes(rel)) return true;
  return SENSITIVE_GLOBS.some((re) => re.test(rel));
}

/** Files that exist on disk and would be dangerous to publish. */
export function sensitiveOnDisk() {
  const out = [];
  for (const rel of SENSITIVE) {
    if (fs.existsSync(path.join(ROOT, rel))) out.push(rel);
  }
  try {
    for (const name of fs.readdirSync(DATA_DIR)) {
      const rel = 'data/' + name;
      if (rel !== 'data/.gitkeep' && !out.includes(rel) && isSensitive(rel)) out.push(rel);
    }
  } catch {
    /* no data dir yet */
  }
  return out;
}

/** Anything git is currently tracking that we never want published. */
export function sensitiveTracked() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return [];
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((x) => x.trim()).filter(isSensitive);
  } catch {
    return [];
  }
}

/** Called on boot: returns human-readable warnings. */
export function privacyReport() {
  const tracked = sensitiveTracked();
  if (!tracked.length) return [];
  return ['⚠ 这些敏感文件正被 git 跟踪，请执行： git rm --cached ' + tracked.join(' ')];
}
