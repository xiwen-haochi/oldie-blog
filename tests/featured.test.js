import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The index reads the site database, so this suite gets its own.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-feat-'));
process.env.OLDIE_DATA_DIR = path.join(tmp, 'data');
process.env.OLDIE_ROOT = tmp;

const { ContentIndex } = await import('../src/lib/posts.js');
const { saveDoc, deleteDoc } = await import('../src/lib/writer.js');
const { sqliteClose } = await import('../src/lib/db.js');

test.after(() => {
  sqliteClose();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the OS will get it */ }
});

/** Store a set of posts, then read them back through a fresh index. */
async function withIndex(specs, fn) {
  const written = [];
  for (const [slug, spec] of Object.entries(specs)) {
    const fields = {
      slug,
      title: slug,
      date: spec.date,
      updated: spec.updated,
      draft: spec.draft,
      featured: spec.featured,
      featuredAt: spec.featuredAt,
      tags: spec.tags || [],
    };
    await saveDoc({ kind: 'post', slug: '', fields, body: 'body of ' + slug, createdAt: spec.createdAt });
    written.push(slug);
  }
  const index = new ContentIndex({});
  try {
    return await fn(index);
  } finally {
    for (const slug of written) await deleteDoc({ kind: 'post', slug });
    index.close();
  }
}

test('every pinned post is returned, not just the first', async () => {
  await withIndex({
    a: { date: '2026-01-01', featured: true, featuredAt: '2026-01-01' },
    b: { date: '2026-02-01', featured: true, featuredAt: '2026-02-01' },
    c: { date: '2026-03-01', featured: true, featuredAt: '2026-03-01' },
  }, (index) => {
    const featured = index.featured();
    assert.equal(featured.length, 3, 'a second pin must not be stranded');
    assert.deepEqual(featured.map((p) => p.slug), ['c', 'b', 'a']);
  });
});

test('pinned posts come back newest-pin-first, not newest-published-first', async () => {
  await withIndex({
    old: { date: '2020-01-01', featured: true, featuredAt: '2026-06-01' },
    recent: { date: '2026-05-01', featured: true, featuredAt: '2026-05-02' },
  }, (index) => {
    assert.equal(index.featured()[0].slug, 'old', 'pinning an old post has to be visible');
  });
});

test('unpinned posts are never featured', async () => {
  await withIndex({
    a: { date: '2026-01-01' },
    b: { date: '2026-02-01' },
  }, (index) => {
    assert.deepEqual(index.featured(), []);
  });
});

test('a draft never sneaks into the pinned section', async () => {
  await withIndex({
    secret: { date: '2026-01-01', featured: true, featuredAt: '2026-01-01', draft: true },
  }, (index) => {
    assert.deepEqual(index.featured(), [], 'a draft must stay private');
  });
});

test('list() puts pinned first, newest pin first, then newest first', async () => {
  await withIndex({
    newest: { date: '2026-06-01' },
    older: { date: '2026-01-01' },
    'old-pinned': { date: '2020-01-01', featured: true, featuredAt: '2026-06-01' },
    'mid-pinned': { date: '2026-05-01', featured: true, featuredAt: '2026-01-01' },
  }, (index) => {
    assert.deepEqual(
      index.list().map((p) => p.slug),
      ['old-pinned', 'mid-pinned', 'newest', 'older'],
      'pinned first, and the most recently pinned of those at the very top'
    );
  });
});

test('a pin with no timestamp still counts as a pin', async () => {
  // this is the shape a hand-edited front matter produces, and sorting it by
  // publish date is what made pinning look broken
  await withIndex({
    plain: { date: '2026-06-01' },
    stamped: { date: '2020-01-01', featured: true, featuredAt: '2026-06-01' },
    unstamped: { date: '2026-03-01', featured: true },
  }, (index) => {
    const slugs = index.list().map((p) => p.slug);
    assert.deepEqual(slugs, ['stamped', 'unstamped', 'plain'], 'an unstamped pin fell behind an unpinned post');
    assert.deepEqual(index.featured().map((p) => p.slug), ['stamped', 'unstamped']);
  });
});

test('three posts written on one day come back in the order they were written', async () => {
  // Same publish date used to fall back to the alphabet, so the post you
  // wrote last was the one furthest down the list.
  await withIndex({
    first: { date: '2026-09-29', createdAt: '2026-09-29T09:00:00.000Z' },
    second: { date: '2026-09-29', createdAt: '2026-09-29T10:00:00.000Z' },
    third: { date: '2026-09-29', createdAt: '2026-09-29T11:00:00.000Z' },
  }, (index) => {
    assert.deepEqual(
      index.list().map((p) => p.slug),
      ['third', 'second', 'first'],
      'a same-day post must not be ordered by its title'
    );
  });
});

test('newest() leads with what was written last, not what was edited last', async () => {
  // Fixing one character in a two-year-old article is not news. The panel is
  // about creation, so an edit must not drag anything to the top of it.
  await withIndex({
    'written-first': { date: '2026-09-29', createdAt: '2026-09-29T09:00:00.000Z' },
    'written-last': { date: '2026-09-29', createdAt: '2026-09-29T11:00:00.000Z' },
    'edited-today': { date: '2020-01-01', updated: '2026-09-29', createdAt: '2020-01-01T09:00:00.000Z' },
  }, (index) => {
    assert.deepEqual(
      index.newest(3).map((p) => p.slug),
      ['written-last', 'written-first', 'edited-today'],
    );
  });
});

test('a post with no creation stamp falls back to its publish date', async () => {
  // 'edited' was saved in 2026 and 'old' was not touched since 2024, and old
  // still comes first: this panel is about writing, not about saving.
  await withIndex({
    old: { date: '2024-01-01' },
    recent: { date: '2026-07-01' },
    edited: { date: '2020-01-01', updated: '2026-01-01', createdAt: '2020-01-01T09:00:00.000Z' },
  }, (index) => {
    assert.deepEqual(index.newest(3).map((p) => p.slug), ['recent', 'old', 'edited']);
  });
});

test('the newest panel never leaks a draft', async () => {
  await withIndex({
    hidden: { date: '2026-07-01', createdAt: '2026-09-29T09:00:00.000Z', draft: true },
    shown: { date: '2020-01-01', createdAt: '2026-01-01T09:00:00.000Z' },
  }, (index) => {
    assert.deepEqual(index.newest(5).map((p) => p.slug), ['shown']);
  });
});

test('newest() honours its limit', async () => {
  await withIndex({
    a: { date: '2026-01-01', createdAt: '2026-01-01T09:00:00.000Z' },
    b: { date: '2026-02-01', createdAt: '2026-02-01T09:00:00.000Z' },
    c: { date: '2026-03-01', createdAt: '2026-03-01T09:00:00.000Z' },
  }, (index) => {
    assert.deepEqual(index.newest(2).map((p) => p.slug), ['c', 'b']);
  });
});

test('editing a post does not move its creation stamp', async () => {
  const { saveDoc: save, readDoc } = await import('../src/lib/writer.js');
  await save({ kind: 'post', slug: '', createdAt: '2026-01-01T09:00:00.000Z',
    fields: { title: 'stamp', slug: 'stamp', date: '2026-01-01', tags: [] }, body: 'one' });
  await save({ kind: 'post', slug: 'stamp',
    fields: { title: 'stamp', slug: 'stamp', date: '2026-01-01', tags: [] }, body: 'two' });
  try {
    assert.equal(readDoc({ kind: 'post', slug: 'stamp' }).createdAt, '2026-01-01T09:00:00.000Z',
      'a save moved the creation time');
  } finally {
    const { deleteDoc: del } = await import('../src/lib/writer.js');
    await del({ kind: 'post', slug: 'stamp' });
  }
});
test('a tag page uses the same order as the index', async () => {
  await withIndex({
    'tagged-plain': { date: '2026-06-01', tags: ['x'] },
    'tagged-pinned': { date: '2026-02-01', featured: true, featuredAt: '2026-02-01', tags: ['x'] },
    'tagged-elsewhere': { date: '2026-07-01', featured: true, featuredAt: '2026-07-01' },
  }, (index) => {
    assert.deepEqual(
      index.postsByTag('x').map((p) => p.slug),
      ['tagged-pinned', 'tagged-plain'],
      'a tag page must pin-sort too, and must not borrow other tags\' pins'
    );
  });
});