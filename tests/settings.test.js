import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, loadConfig } from '../src/lib/config.js';
import { checkUpload, driverName, isAllowedType, maxBytes, extFor, describeStorage } from '../src/lib/storage.js';

test('feature switches exist and default to on', () => {
  for (const key of ['comments', 'moderateComments', 'guestbook', 'moderateGuestbook', 'search', 'hitCounter', 'randomPost', 'showToc']) {
    assert.equal(typeof DEFAULTS.features[key], 'boolean', 'missing switch: ' + key);
    assert.equal(DEFAULTS.features[key], true, 'expected ' + key + ' to default on');
  }
});

test('a config that predates the switches still loads', () => {
  const site = loadConfig({ env: {} });
  // whatever the owner has customised, every switch must still be a boolean
  for (const key of Object.keys(DEFAULTS.features)) {
    assert.equal(typeof site.features[key], 'boolean', 'not a boolean: ' + key);
  }
  assert.ok(['local', 's3'].includes(site.storage.driver));
});

test('storage defaults to the local driver', () => {
  const site = loadConfig({ env: {} });
  assert.equal(driverName(site), 'local');
  assert.equal(maxBytes(site), 4 * 1024 * 1024);
  assert.match(describeStorage(site).label, /本地/);
});

test('the s3 driver needs bucket, endpoint and keys', () => {
  const base = loadConfig({ env: {} });
  assert.equal(
    checkUpload({ storage: { driver: 's3', s3: {} } }, { size: 10, type: 'image/png' }),
    '对象存储未配置：缺少 bucket / endpoint / accessKeyId / secretAccessKey'
  );
  assert.equal(checkUpload({ storage: { driver: 's3', s3: { bucket: 'b' } } }, { size: 10, type: 'image/png' }), '对象存储未配置：缺少 endpoint / accessKeyId / secretAccessKey');
  assert.equal(
    checkUpload({ storage: { driver: 's3', s3: { bucket: 'b', endpoint: 'https://x' } } }, { size: 10, type: 'image/png' }),
    '对象存储未配置：缺少 accessKeyId / secretAccessKey'
  );
  const ok = checkUpload({ storage: { driver: 's3', s3: { bucket: 'b', endpoint: 'https://x', accessKeyId: 'k', secretAccessKey: 's' } } }, { size: 10, type: 'image/png' });
  assert.equal(ok, null, 'a complete config should accept: ' + ok);
});

test('uploads are size and type checked', () => {
  const site = loadConfig({ env: {} });
  assert.match(checkUpload(site, { size: 10 * 1024 * 1024, type: 'image/png' }), /太大/);
  assert.match(checkUpload(site, { size: 10, type: 'application/pdf' }), /只接受图片/);
  assert.equal(checkUpload(site, { size: 100, type: 'image/png' }), null);
  assert.equal(isAllowedType('image/svg+xml'), true);
  assert.equal(isAllowedType('text/html'), false);
});

test('extensions follow the mime type', () => {
  assert.equal(extFor('image/png'), 'png');
  assert.equal(extFor('image/jpeg'), 'jpg');
  assert.equal(extFor('image/svg+xml'), 'svg');
  assert.equal(extFor('application/octet-stream'), 'bin');
});
