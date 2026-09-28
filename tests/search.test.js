import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIndex, search, parseQuery, makeSnippet } from '../src/lib/search.js';

const POSTS = [
  {
    slug: 'a',
    title: 'Writing in Markdown',
    description: 'Plain text files for the modern web',
    tags: ['markdown', 'writing'],
    plain: 'Markdown files are portable and git friendly. Front matter holds the metadata.',
    wordCount: 10,
    date: new Date('2025-01-01'),
    draft: false,
    url: '/posts/a',
  },
  {
    slug: 'b',
    title: 'A DOS terminal in every page',
    description: 'Play with your website',
    tags: ['code', 'retro'],
    plain: 'The terminal runs commands against the site index. dir lists the posts.',
    wordCount: 12,
    date: new Date('2025-02-01'),
    draft: false,
    url: '/posts/b',
  },
  {
    slug: 'c',
    title: 'Draft thoughts',
    description: 'not public',
    tags: ['secret'],
    plain: 'hidden draft body markdown',
    wordCount: 5,
    date: new Date('2025-03-01'),
    draft: true,
    url: '/posts/c',
  },
];

const index = buildIndex(POSTS);

test('parses operators out of a query', () => {
  const q = parseQuery('tag:markdown "exact phrase" -nope in:title');
  assert.deepEqual(q.tags, ['markdown']);
  assert.deepEqual(q.phrases, ['exact phrase']);
  assert.deepEqual(q.excludes, ['nope']);
  assert.deepEqual(q.fields, ['title']);
});

test('finds posts by title, tag and body', () => {
  assert.equal(search(index, 'markdown').length, 1);
  assert.equal(search(index, 'terminal').length, 1);
  assert.equal(search(index, 'portable').length, 1);
  assert.equal(search(index, 'nothingatall').length, 0);
});

test('tag: filter narrows results', () => {
  const hits = search(index, 'tag:retro');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].slug, 'b');
});

test('quoted phrases must match exactly', () => {
  assert.equal(search(index, '"DOS terminal"').length, 1);
  assert.equal(search(index, '"terminal DOS"').length, 0);
});

test('exclusions remove matches', () => {
  assert.equal(search(index, 'markdown').length, 1);
  assert.equal(search(index, 'markdown -portable').length, 0);
});

test('drafts never appear in results', () => {
  assert.equal(search(index, 'secret').length, 0);
  assert.equal(search(index, 'markdown').some((r) => r.slug === 'c'), false);
});

test('results carry the fields templates need', () => {
  const [hit] = search(index, 'markdown');
  for (const key of ['slug', 'title', 'url', 'date', 'tags', 'description', 'readingTime', 'snippet']) {
    assert.ok(key in hit, 'missing ' + key);
  }
});

test('snippets wrap the match in a mark tag', () => {
  const [hit] = search(index, 'portable');
  assert.match(hit.snippet, /<mark>portable<\/mark>/);
});

test('makeSnippet falls back to a plain excerpt', () => {
  const out = makeSnippet(POSTS[0], []);
  assert.ok(out.length > 0);
  assert.ok(!out.includes('<mark>'));
});

test('in:title restricts the search to titles', () => {
  assert.equal(search(index, 'in:title terminal').length, 1);
  assert.equal(search(index, 'in:title portable').length, 0);
});
