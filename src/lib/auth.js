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

/** Plaintext ADMIN_PASSWORD env / config shortcut used on first boot. */
export function ensureAdminCredentials(config, { persist = true } = {}) {
  const file = path.join(CONFIG_DIR, 'admin.json');
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { stored = {}; }

  if (config.admin?.password) {
    stored = { ...stored, username: config.admin.username || 'admin', password: hashPassword(config.admin.password) };
  } else if (!stored.password) {
    const generated = crypto.randomBytes(9).toString('base64url');
    stored = { username: 'admin', password: hashPassword(generated), mustChange: true };
    console.log('\n┌─ first run ─────────────────────────────────────────────┐');
    console.log('│ admin user : admin                                     │');
    console.log('│ temp pass  : ' + generated.padEnd(44) + '│');
    console.log('│ saved to   : config/admin.json  (change it!)            │');
    console.log('└──────────────────────────────────────────────────────────┘\n');
  }

  stored.updatedAt = new Date().toISOString();
  if (persist) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
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
