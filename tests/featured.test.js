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
    await saveDoc({ kind: 'post', slug: '', fields, body: 'body of ' + slug });
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

test('recently updated is the post you touched, not the newest one', async () => {
  // the home page panel used to be four sentences typed into the template,
  // so editing a post could never change it
  await withIndex({
    'published-latest': { date: '2026-07-01' },
    'edited-just-now': { date: '2020-01-01', updated: '2026-09-29' },
  }, (index) => {
    assert.deepEqual(
      index.recentlyUpdated(2).map((p) => p.slug),
      ['edited-just-now', 'published-latest'],
      'editing an old post has to move it to the top'
    );
  });
});

test('a post that was never edited falls back to its publish date', async () => {
  await withIndex({
    old: { date: '2024-01-01' },
    recent: { date: '2026-07-01' },
    edited: { date: '2020-01-01', updated: '2026-01-01' },
  }, (index) => {
    assert.deepEqual(
      index.recentlyUpdated(3).map((p) => p.slug),
      ['recent', 'edited', 'old'],
    );
  });
});

test('the recent panel never leaks a draft', async () => {
  await withIndex({
    hidden: { date: '2026-07-01', updated: '2026-09-29', draft: true },
    shown: { date: '2020-01-01', updated: '2026-01-01' },
  }, (index) => {
    assert.deepEqual(index.recentlyUpdated(5).map((p) => p.slug), ['shown']);
  });
});

test('recently updated honours its limit', async () => {
  await withIndex({
    a: { date: '2026-01-01', updated: '2026-09-01' },
    b: { date: '2026-02-01', updated: '2026-08-01' },
    c: { date: '2026-03-01', updated: '2026-07-01' },
  }, (index) => {
    assert.deepEqual(index.recentlyUpdated(2).map((p) => p.slug), ['a', 'b']);
  });
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