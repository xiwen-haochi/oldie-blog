import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createZip, readZip, crc32, safeEntryPath } from '../src/lib/zip.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-zip-'));
const has = (bin) => {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

test('crc32 matches the known value for 123456789', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('a zip round-trips text, unicode, binary and empty files', () => {
  const binary = Buffer.from(Array.from({ length: 500 }, (_, i) => i % 256));
  const entries = [
    { name: 'hello.txt', data: 'hello zip world' },
    { name: '中文/文章.md', data: '# 标题\n\n正文 content.' },
    { name: 'uploads/pixel.png', data: binary },
    { name: 'empty.txt', data: '' },
  ];
  const back = readZip(createZip(entries));
  assert.equal(back.length, entries.length);
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  assert.equal(back[0].data.toString('utf8'), 'hello zip world');
  assert.equal(back[1].data.toString('utf8'), '# 标题\n\n正文 content.');
  assert.deepEqual(back[2].data, binary);
  assert.equal(back[3].data.length, 0);
});

test('deflates what compresses, stores what does not', () => {
  const zip = createZip([
    { name: 'big.txt', data: 'aaaa'.repeat(5000) },
    { name: 'rand.bin', data: Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 251)) },
  ]);
  assert.ok(zip.length < 2000, 'repetitive text should compress hard, got ' + zip.length);
  const back = readZip(zip);
  assert.equal(back[0].data.length, 20000);
  assert.equal(back[1].data.length, 4000);
});

test('the system unzip reads what we write', { skip: !has('unzip') }, () => {
  const file = path.join(tmp, 'roundtrip.zip');
  fs.writeFileSync(file, createZip([
    { name: 'note.txt', data: 'plain text file' },
    { name: 'data/settings.json', data: JSON.stringify({ title: '老博客' }) },
  ]));
  const listed = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
  assert.match(listed, /note\.txt/);
  assert.match(listed, /settings\.json/);
  execFileSync('unzip', ['-o', '-q', file, '-d', path.join(tmp, 'out')]);
  assert.equal(fs.readFileSync(path.join(tmp, 'out', 'note.txt'), 'utf8'), 'plain text file');
  assert.match(fs.readFileSync(path.join(tmp, 'out', 'data', 'settings.json'), 'utf8'), /老博客/);
});

test('we read a zip made by the system zip tool', { skip: !has('zip') }, () => {
  const dir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'made by zip');
  fs.writeFileSync(path.join(dir, 'data', 'b.json'), '{"ok":true}');
  const file = path.join(tmp, 'made-by-zip.zip');
  execFileSync('zip', ['-qr', file, 'a.txt', 'data'], { cwd: dir });
  const entries = readZip(fs.readFileSync(file));
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('a.txt'), names.join(','));
  assert.equal(entries.find((e) => e.name === 'a.txt').data.toString('utf8'), 'made by zip');
  assert.equal(entries.find((e) => e.name === 'data/b.json').data.toString('utf8'), '{"ok":true}');
});

test('junk is rejected with a helpful message', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all')), /zip/);
  assert.throws(() => readZip(Buffer.alloc(4)), /zip/);
});

test('zip slip is refused', () => {
  assert.equal(safeEntryPath('content/posts/a.md'), 'content/posts/a.md');
  assert.equal(safeEntryPath('/data/x.json'), 'data/x.json');
  assert.equal(safeEntryPath('a\\b\\c.md'), 'a/b/c.md');
  assert.throws(() => safeEntryPath('../etc/passwd'), /不安全/);
  assert.throws(() => safeEntryPath('a/../../etc/passwd'), /不安全/);
});
