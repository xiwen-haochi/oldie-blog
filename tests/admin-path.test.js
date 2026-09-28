import test from 'node:test';
import assert from 'node:assert/strict';

import { normaliseAdminPath } from '../src/lib/config.js';
import { robotsTxt } from '../src/lib/feeds.js';

const site = {
  title: 'x',
  url: 'http://localhost:4173',
  description: 'd',
  author: 'a',
  locale: 'zh-CN',
};

test('admin path accepts the shapes people actually type', () => {
  assert.equal(normaliseAdminPath('admin'), '/admin');
  assert.equal(normaliseAdminPath('/admin'), '/admin');
  assert.equal(normaliseAdminPath('/admin/'), '/admin');
  assert.equal(normaliseAdminPath('  my-secret-door  '), '/my-secret-door');
  assert.equal(normaliseAdminPath('/后台/'), '/后台');
  assert.equal(normaliseAdminPath('/a b c'), '/abc');
});

test('admin path falls back to /admin for anything unusable', () => {
  for (const bad of ['', '   ', '/', null, undefined, '//', 0]) {
    assert.equal(normaliseAdminPath(bad), '/admin', 'bad input: ' + JSON.stringify(bad));
  }
});

test('the admin path never escapes the site root', () => {
  // '..' segments are dropped, so the result is always inside the site
  assert.equal(normaliseAdminPath('/../etc/passwd'), '/etc/passwd');
  assert.equal(normaliseAdminPath('/../../..'), '/admin');
  assert.equal(normaliseAdminPath('//evil.com'), '/evilcom');
  assert.ok(normaliseAdminPath('/secret?a=b').startsWith('/'));
  assert.ok(!normaliseAdminPath('/secret#x').includes('#'));
  assert.ok(!normaliseAdminPath('/a<b>').includes('<'));
});

test('robots.txt never advertises the configured admin path', () => {
  const txt = robotsTxt(site);
  assert.match(txt, /Disallow: \/admin/);
  assert.ok(!txt.includes('/my-secret-door'), 'a secret door does not belong in robots.txt');
});

test('robots.txt still blocks the usual suspects', () => {
  const txt = robotsTxt(site);
  for (const blocked of ['/admin', '/api/terminal', '/dashboard']) {
    assert.match(txt, new RegExp('Disallow: ' + blocked.replace('/', '\\/')));
  }
});
