import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Articles live in the site database now, so this suite needs its own.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-writer-'));
process.env.OLDIE_DATA_DIR = path.join(tmp, 'data');
process.env.OLDIE_ROOT = tmp;

const { frontMatter, normaliseFields, rawOf, saveDoc, deleteDoc, readDoc, docExists, listDocs, fileNameFor } =
  await import('../src/lib/writer.js');
const { ContentIndex, paginate, parseDoc } = await import('../src/lib/posts.js');
const { sqliteClose } = await import('../src/lib/db.js');

test.after(() => {
  sqliteClose();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the OS will get it */ }
});

const post = (over = {}) =>
  normaliseFields({ title: 'Hello there', date: '2025-06-01', body: 'x', ...over });

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

test('parseDoc reads a stored document', () => {
  const doc = parseDoc(
    { kind: 'post', slug: 'hello-there', frontMatter: { title: 'Hello', tags: ['a', 'b'], date: '2025-06-01' }, body: '\n# Hi\n' },
    { kind: 'post' }
  );
  assert.equal(doc.slug, 'hello-there');
  assert.equal(doc.title, 'Hello');
  assert.deepEqual(doc.tags, ['a', 'b']);
  assert.equal(doc.url, '/posts/hello-there');
  assert.equal(doc.txtUrl, '/posts/hello-there.txt');
  assert.match(doc.html, /<h1 id="hi"/);
  assert.equal(doc.key, 'post:hello-there');
  assert.ok(doc.readingTime >= 1);
  assert.ok(doc.wordCount > 0);
});

test('parseDoc gives a page its own url', () => {
  const doc = parseDoc(
    { kind: 'page', slug: 'about', frontMatter: { title: 'About this site' }, body: '\nHello.\n' },
    { kind: 'page' }
  );
  assert.equal(doc.slug, 'about');
  assert.equal(doc.url, '/about');
  assert.equal(doc.txtUrl, null);
});

test('a saved post round-trips through the database', async () => {
  const fields = post();
  const saved = await saveDoc({ kind: 'post', slug: '', fields, body: '# Body\n\nText.' });
  assert.equal(saved.created, true);
  assert.equal(saved.key, 'post:hello-there');
  assert.equal(saved.file, '2025-06-01-hello-there.md', 'the export name keeps the date prefix');

  assert.ok(docExists({ kind: 'post', slug: 'hello-there' }));
  const back = rawOf({ kind: 'post', slug: 'hello-there' });
  assert.equal(back.data.title, 'Hello there');
  assert.match(back.body, /# Body/);
  assert.equal(back.file, '2025-06-01-hello-there.md');

  const updated = await saveDoc({ kind: 'post', slug: 'hello-there', fields: { ...fields, title: 'Changed' }, body: 'x' });
  assert.equal(updated.created, false, 'an edit is not a create');
  assert.equal(rawOf({ kind: 'post', slug: 'hello-there' }).data.title, 'Changed');

  assert.equal(await deleteDoc({ kind: 'post', slug: 'hello-there' }), true);
  assert.equal(docExists({ kind: 'post', slug: 'hello-there' }), false);
  assert.equal(await deleteDoc({ kind: 'post', slug: 'hello-there' }), false, 'deleting twice is not an error');
});

test('renaming a post does not leave the old one behind', async () => {
  // The slug only moves once the new title has been through normaliseFields,
  // which is exactly what the admin route does on every save.
  const before = post({ title: 'Rename me' });
  await saveDoc({ kind: 'post', slug: '', fields: before, body: 'x' });
  const after = normaliseFields({ title: 'Renamed elsewhere', date: before.date }, before);
  assert.notEqual(after.slug, before.slug, 'the slug should have moved');
  await saveDoc({ kind: 'post', slug: before.slug, fields: after, body: 'x' });
  assert.equal(docExists({ kind: 'post', slug: before.slug }), false, 'the old slug survived the rename');
  assert.ok(docExists({ kind: 'post', slug: after.slug }));
  await deleteDoc({ kind: 'post', slug: after.slug });
});

test('a post and a page can share a slug', async () => {
  const fields = post({ title: 'Same Name' });
  await saveDoc({ kind: 'post', slug: '', fields, body: 'post body' });
  await saveDoc({ kind: 'page', slug: '', fields, body: 'page body' });
  assert.equal(rawOf({ kind: 'post', slug: 'same-name' }).body, 'post body');
  assert.equal(rawOf({ kind: 'page', slug: 'same-name' }).body, 'page body');
  await deleteDoc({ kind: 'post', slug: 'same-name' });
  await deleteDoc({ kind: 'page', slug: 'same-name' });
});

test('unknown slugs return null rather than throwing', () => {
  assert.equal(readDoc({ kind: 'post', slug: 'does-not-exist' }), null);
  assert.equal(rawOf({ kind: 'post', slug: 'does-not-exist' }), null);
  assert.equal(docExists({ kind: 'post', slug: 'does-not-exist' }), false);
});

test('listDocs only returns what was asked for', async () => {
  await saveDoc({ kind: 'post', slug: '', fields: post({ title: 'Listed' }), body: 'x' });
  assert.equal(listDocs('post').length, 1);
  assert.equal(listDocs('page').length, 0);
  await deleteDoc({ kind: 'post', slug: 'listed' });
});

test('fileNameFor keeps the dated export name', () => {
  assert.equal(fileNameFor({ date: '2025-06-01', slug: 'x' }), '2025-06-01-x.md');
  assert.equal(fileNameFor({ date: 'nonsense', slug: 'x' }), '0000-00-00-x.md');
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
  assert.equal(paginate(items, -5, 10).page, 1);
  const empty = paginate([], 1, 10);
  assert.equal(empty.pages, 1);
  assert.deepEqual(empty.range, [0, 0]);
});

test('ContentIndex starts empty and picks up what is stored', async () => {
  const idx = new ContentIndex({});
  assert.deepEqual(idx.posts(), []);
  assert.deepEqual(idx.allTags(), []);
  assert.equal(idx.randomPost(), null);
  assert.equal(idx.totalWords(), 0);

  await saveDoc({ kind: 'post', slug: '', fields: post({ title: 'Indexed', tags: ['x'] }), body: 'Some words here.' });
  idx.reload();
  assert.equal(idx.publishedPosts().length, 1);
  assert.equal(idx.getPost('indexed').title, 'Indexed');
  assert.equal(idx.allTags()[0].count, 1);
  assert.ok(idx.totalWords() > 0);
  await deleteDoc({ kind: 'post', slug: 'indexed' });
  idx.reload();
  assert.deepEqual(idx.posts(), []);
  idx.close();
});
