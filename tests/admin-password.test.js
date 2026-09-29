import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureAdminCredentials, verifyPassword, hashPassword } from '../src/lib/auth.js';

function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-cfg-'));
  const configDir = path.join(dir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  try {
    return fn(path.join(configDir, 'admin.json'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the first boot takes the password from the environment', () => {
  withConfigDir((file) => {
    const stored = ensureAdminCredentials({ admin: { password: 'from-the-env' } }, { dir: path.dirname(file) });
    assert.equal(stored.username, 'admin');
    assert.ok(verifyPassword('from-the-env', stored.password), 'the env password should work');
  });
});

test('with no environment password the first boot generates one', () => {
  withConfigDir((file) => {
    const stored = ensureAdminCredentials({}, { dir: path.dirname(file) });
    assert.ok(stored.password, 'a password is always produced');
    assert.equal(stored.mustChange, true, 'a generated password must ask to be changed');
  });
});

test('a password changed in the admin survives a restart', () => {
  withConfigDir((file) => {
    const dir = path.dirname(file);
    // first boot seeds from the environment
    ensureAdminCredentials({ admin: { password: 'from-the-env' } }, { dir });

    // the operator picks their own password in the admin
    fs.writeFileSync(file, JSON.stringify({
      username: 'admin',
      password: hashPassword('chosen-by-hand'),
    }, null, 2));

    // the environment variable is still set — it is still in Railway
    const stored = ensureAdminCredentials({ admin: { password: 'from-the-env' } }, { dir });
    assert.ok(
      verifyPassword('chosen-by-hand', stored.password),
      'a restart must not silently reset the password back to the env value'
    );
  });
});

test('the stored password file is what a restart keeps using', () => {
  withConfigDir((file) => {
    const dir = path.dirname(file);
    ensureAdminCredentials({ admin: { password: 'first-boot' } }, { dir });
    const first = JSON.parse(fs.readFileSync(file, 'utf8'));
    const second = ensureAdminCredentials({ admin: { password: 'first-boot' } }, { dir });
    assert.equal(first.password, second.password, 'a plain restart must not rotate the hash');
  });
});
