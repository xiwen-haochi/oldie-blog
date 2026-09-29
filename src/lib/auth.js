import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, DATA_DIR } from './paths.js';

/* ---------------------------------------------------------------- passwords */

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Decide the password in force.
 *
 * ADMIN_PASSWORD seeds the very first boot, and only that: once a password is
 * stored, whatever the operator typed in the admin is the real one. Seeding on
 * every boot would quietly undo their change on each restart, which is exactly
 * the kind of surprise a login form should never spring on anybody.
 */
export function ensureAdminCredentials(config, { persist = true, dir = CONFIG_DIR } = {}) {
  const file = path.join(dir, 'admin.json');
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { stored = {}; }

  if (!stored.password && config.admin?.password) {
    // first boot: take the one from the environment
    stored = {
      username: config.admin.username || 'admin',
      password: hashPassword(config.admin.password),
      seededFromEnv: true,
    };
  } else if (!stored.password) {
    const generated = crypto.randomBytes(9).toString('base64url');
    stored = { username: 'admin', password: hashPassword(generated), mustChange: true };
    console.log('\n┌─ first run ─────────────────────────────────────────────┐');
    console.log('│ admin user : admin                                     │');
    console.log('│ temp pass  : ' + generated.padEnd(44) + '│');
    console.log('│ saved to   : config/admin.json  (change it!)            │');
    console.log('└──────────────────────────────────────────────────────────┘\n');
  } else if (config.admin?.password && stored.seededFromEnv) {
    // the seed already happened; the operator owns the password from here on
    delete stored.seededFromEnv;
  }

  stored.updatedAt = new Date().toISOString();
  if (persist) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  }
  return stored;
}

export function loadCredentials() {
  try { return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'admin.json'), 'utf8')); }
  catch { return { username: 'admin' }; }
}

export function saveCredentials(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, 'admin.json'), JSON.stringify(next, null, 2) + '\n');
  try { fs.chmodSync(path.join(CONFIG_DIR, 'admin.json'), 0o600); } catch { /* best effort */ }
}
