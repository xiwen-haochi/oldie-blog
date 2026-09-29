import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ContentIndex } from '../src/lib/posts.js';

function makeIndex(specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-feat-'));
  const posts = path.join(dir, 'posts');
  const pages = path.join(dir, 'pages');
  fs.mkdirSync(posts, { recursive: true });
  fs.mkdirSync(pages, { recursive: true });
  for (const [slug, spec] of Object.entries(specs)) {
    const fm = [
      '---',
      'title: ' + slug,
      'date: ' + spec.date,
      spec.draft ? 'draft: true' : '',
      spec.featured ? 'featured: true' : '',
      spec.featuredAt ? 'featuredAt: "' + spec.featuredAt + '"' : '',
      '---',
      '',
      'body of ' + slug,
    ].filter(Boolean).join('\n');
    fs.writeFileSync(path.join(posts, slug + '.md'), fm);
  }
  const index = new ContentIndex({ postsDir: posts, pagesDir: pages });
  return { index, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('every pinned post is returned, not just the first', () => {
  const { index, cleanup } = makeIndex({
    a: { date: '2026-01-01', featured: true, featuredAt: '2026-01-01' },
    b: { date: '2026-02-01', featured: true, featuredAt: '2026-02-01' },
    c: { date: '2026-03-01', featured: true, featuredAt: '2026-03-01' },
  });
  try {
    const featured = index.featured();
    assert.equal(featured.length, 3, 'a second pin must not be stranded');
    assert.deepEqual(featured.map((p) => p.slug), ['c', 'b', 'a']);
  } finally { cleanup(); }
});

test('pinned posts come back newest-pin-first, not newest-published-first', () => {
  const { index, cleanup } = makeIndex({
    old: { date: '2020-01-01', featured: true, featuredAt: '2026-06-01' },
    recent: { date: '2026-05-01', featured: true, featuredAt: '2026-05-02' },
  });
  try {
    assert.equal(index.featured()[0].slug, 'old', 'pinning an old post has to be visible');
  } finally { cleanup(); }
});

test('unpinned posts are never featured', () => {
  const { index, cleanup } = makeIndex({
    a: { date: '2026-01-01' },
    b: { date: '2026-02-01' },
  });
  try {
    assert.deepEqual(index.featured(), []);
  } finally { cleanup(); }
});

test('a draft never sneaks into the pinned section', () => {
  const { index, cleanup } = makeIndex({
    secret: { date: '2026-01-01', featured: true, featuredAt: '2026-01-01', draft: true },
  });
  try {
    assert.deepEqual(index.featured(), [], 'a draft must stay private');
  } finally { cleanup(); }
});
