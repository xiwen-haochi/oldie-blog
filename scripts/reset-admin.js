#!/usr/bin/env node
/**
 * Reset the admin password when you have lost it.
 *
 *   pnpm reset:admin                 → generate a strong password and print it
 *   pnpm reset:admin "my password"   → set a password you choose
 *   pnpm reset:admin --user zhang    → also change the username
 *
 * Writes a scrypt hash to config/admin.json (gitignored, chmod 600).
 * No server restart needed — the next login picks it up.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_DIR } from '../src/lib/paths.js';
import { hashPassword } from '../src/lib/auth.js';

const args = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const i = args.indexOf('--' + name);
  return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const file = path.join(CONFIG_DIR, 'admin.json');
/** The admin path is configurable, so read it rather than guessing. */
function adminPathFromConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'site.config.json'), 'utf8'));
    return cfg.adminPath || '/admin';
  } catch {
    return '/admin';
  }
}

let current = {};
try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first boot */ }

const username = flag('user', current.username || 'admin');
const chosen = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--user' && args[args.indexOf(a) - 1] !== '--random');
const password = chosen || flag('password', '') || crypto.randomBytes(9).toString('base64url');

if (password.length < 8) {
  console.error('太短了：密码至少 8 位。');
  process.exit(1);
}

const next = {
  username,
  password: hashPassword(password),
  mustChange: false,
  updatedAt: new Date().toISOString(),
};

fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }

console.log('');
console.log('  用户名 : ' + username);
console.log('  密码   : ' + password);
console.log('  文件   : config/admin.json');
console.log('');
console.log('  现在就能登录：' + adminPathFromConfig() + '（/admin 是默认值）');
console.log('  建议登录后在「设置 → 密码」里再改一次。');
console.log('');
