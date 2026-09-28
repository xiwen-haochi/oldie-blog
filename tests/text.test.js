import test from 'node:test';
import assert from 'node:assert/strict';

import { slugify, truncate, readingTime, countWords, stripHtml, formatDate, tokenize, timeAgo } from '../src/lib/text.js';

test('slugify keeps CJK and lowercases latin', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('  --Weird__Slug--  '), 'weird-slug');
  assert.equal(slugify('网页设计 1998'), '网页设计-1998');
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify('!!!'), 'untitled');
});

test('slugify is stable for titles with apostrophes', () => {
  assert.equal(slugify("It's a Blog"), 'its-a-blog');
  assert.equal(slugify('The "Best" Page'), 'the-best-page');
});

test('reading time handles both scripts', () => {
  const english = readingTime('word '.repeat(220));
  assert.ok(english >= 1 && english <= 1.1, 'english: ' + english);
  const chinese = readingTime('字'.repeat(400));
  assert.ok(chinese >= 1 && chinese <= 1.1, 'chinese: ' + chinese);
  assert.ok(readingTime('tiny') >= 1, 'never below one minute');
});

test('countWords separates CJK from latin', () => {
  const c = countWords('hello 世界');
  assert.equal(c.latin, 1);
  assert.equal(c.cjk, 2);
  assert.equal(c.total, 3);
});

test('stripHtml removes tags and decodes entities', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(stripHtml('a &amp; b &lt;tag&gt;'), 'a & b <tag>');
  assert.equal(stripHtml('<script>bad()</script>safe'), 'safe');
});

test('truncate respects display width and adds an ellipsis', () => {
  assert.equal(truncate('short', 100), 'short');
  const out = truncate('x'.repeat(200), 20);
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= 20);
  const cjk = truncate('中文'.repeat(50), 20);
  assert.ok(cjk.endsWith('…'));
  assert.ok(cjk.length <= 20, 'cjk width respected: ' + cjk.length);
});

test('formatDate renders the configured styles', () => {
  const d = new Date('2025-03-21T00:00:00Z');
  assert.equal(formatDate(d, { style: 'iso' }), '2025-03-21');
  assert.equal(formatDate(d, { locale: 'en' }), '21 March 2025');
  assert.equal(formatDate(d, { locale: 'zh-CN' }), '2025年3月21日');
  assert.match(formatDate(d, { style: 'rfc822' }), /21 Mar 2025 \d\d:\d\d:\d\d GMT/);
  assert.equal(formatDate('not a date'), '');
});

test('timeAgo produces human strings', () => {
  const mins = new Date(Date.now() - 5 * 60 * 1000);
  assert.match(timeAgo(mins), /5 min ago/);
  const days = new Date(Date.now() - 3 * 86400000);
  assert.match(timeAgo(days), /3d ago/);
});

test('tokenize emits CJK unigrams and bigrams', () => {
  const tokens = tokenize('网页设计');
  assert.ok(tokens.includes('网'));
  assert.ok(tokens.includes('网页'), 'bigram missing');
});

test('tokenize stems long latin words', () => {
  const tokens = tokenize('markdown');
  assert.ok(tokens.includes('markdown'));
  assert.ok(tokens.includes('markdow'));
});
