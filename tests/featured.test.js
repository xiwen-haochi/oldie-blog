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
      draft: spec.draft,
      featured: spec.featured,
      featuredAt: spec.featuredAt,
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
