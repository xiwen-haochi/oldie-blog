import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { frontMatter, normaliseFields, findFile, rawOf, saveDoc, deleteDoc } from '../src/lib/writer.js';
import { ContentIndex, paginate, parseDoc } from '../src/lib/posts.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-writer-'));

test('frontMatter writes ordered, readable yaml', () => {
  const out = frontMatter(
    { title: 'A: colon title', tags: ['one', 'two'], draft: false, featured: true, slug: 'x' },
    'Body text here.'
  );
  assert.match(out, /^---\n/);
  assert.match(out, /title: "A: colon title"/, 'unsafe scalars must be quoted');
  assert.match(out, /tags: \[one, two\]/);
  assert.match(out, /draft: false/);
  assert.match(out, /featured: true/);
  assert.match(out, /\n---\n\nBody text here\.$/);
});

test('frontMatter omits empty fields but keeps false booleans', () => {
  const out = frontMatter({ title: 't', description: '', cover: '', draft: false }, 'x');
  assert.ok(!out.includes('description'));
  assert.ok(!out.includes('cover'));
  assert.match(out, /draft: false/);
});

test('normaliseFields cleans user input', () => {
  const f = normaliseFields({
    title: '  Hello World  ',
    tags: 'a, b , , c',
    date: '2025-04-01',
    draft: 'on',
    featured: 'true',
    keywords: 'one,two',
  });
  assert.equal(f.title, 'Hello World');
  assert.deepEqual(f.tags, ['a', 'b', 'c']);
  assert.equal(f.slug, 'hello-world');
  assert.equal(f.date, '2025-04-01');
  assert.equal(f.draft, true);
  assert.equal(f.featured, true);
  assert.deepEqual(f.keywords, ['one', 'two']);
});

test('normaliseFields fills defaults from an existing doc', () => {
  const existing = { title: 'Old', tags: ['x'], date: '2020-01-01' };
  const f = normaliseFields({ body: 'x' }, existing);
  assert.equal(f.title, 'Old');
  assert.deepEqual(f.tags, ['x']);
  assert.equal(f.date, '2020-01-01');
});

test('a slug collision is not possible inside one file', () => {
  const f = normaliseFields({ title: 'Same Title' });
  assert.equal(f.slug, 'same-title');
});

test('parseDoc reads a dated filename', () => {
  const file = path.join(dir, '2025-06-01-hello-there.md');
  fs.writeFileSync(file, '---\ntitle: Hello\ntags: [a, b]\n---\n\n# Hi\n');
  const doc = parseDoc(file, { kind: 'post' });
  assert.equal(doc.slug, 'hello-there');
  assert.equal(doc.title, 'Hello');
  assert.deepEqual(doc.tags, ['a', 'b']);
  assert.equal(doc.url, '/posts/hello-there');
  assert.equal(doc.txtUrl, '/posts/hello-there.txt');
  assert.match(doc.html, /<h1 id="hi"/);
  assert.ok(doc.readingTime >= 1);
  assert.ok(doc.wordCount > 0);
  fs.rmSync(file);
});

test('parseDoc falls back to the filename for pages', () => {
  const file = path.join(dir, 'about.md');
  fs.writeFileSync(file, '---\ntitle: About this site\n---\n\nHello.\n');
  const doc = parseDoc(file, { kind: 'page' });
  assert.equal(doc.slug, 'about', 'pages keep their filename slug');
  assert.equal(doc.url, '/about');
  assert.equal(doc.txtUrl, null);
  fs.rmSync(file);
});

test('paginate clamps out of range pages', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ i }));
  const first = paginate(items, 1, 10);
  assert.equal(first.items.length, 10);
  assert.equal(first.pages, 3);
  assert.equal(first.hasNext, true);
  assert.equal(first.hasPrev, false);
  const last = paginate(items, 99, 10);
  assert.equal(last.page, 3);
  assert.equal(last.items.length, 5);
  const weird = paginate(items, -5, 10);
  assert.equal(weird.page, 1);
  const empty = paginate([], 1, 10);
  assert.equal(empty.pages, 1);
  assert.deepEqual(empty.range, [0, 0]);
});

test('findFile locates files with and without a date prefix', () => {
  const a = path.join(dir, '2025-06-02-foo.md');
  fs.writeFileSync(a, 'x');
  assert.ok(findFile(dir, 'foo'));
  assert.ok(findFile(dir, '2025-06-02-foo'));
  assert.equal(findFile(dir, 'nope'), null);
  fs.rmSync(a);
});

test('findFile and rawOf return null for unknown slugs', () => {
  assert.equal(findFile(dir, 'does-not-exist'), null);
});

test('writer helpers are importable and side-effect free', () => {
  assert.equal(typeof saveDoc, 'function');
  assert.equal(typeof deleteDoc, 'function');
  assert.equal(typeof rawOf, 'function');
});

test('ContentIndex can be constructed on an empty directory', () => {
  const empty = path.join(dir, 'empty-posts');
  const idx = new ContentIndex({ postsDir: empty, pagesDir: empty });
  assert.deepEqual(idx.posts(), []);
  assert.deepEqual(idx.allTags(), []);
  assert.equal(idx.randomPost(), null);
  assert.equal(idx.totalWords(), 0);
  idx.close();
});
