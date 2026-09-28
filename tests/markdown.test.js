import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { renderMarkdown, toPlainText, excerpt, splitAtMore, buildToc, createRenderer } from '../src/lib/markdown.js';

test('renders markdown with heading anchors', () => {
  const html = renderMarkdown('## Hello World');
  assert.match(html, /<h2 id="hello-world">/);
  assert.match(html, /class="anchor" href="#hello-world"/);
});

test('duplicate headings get unique ids', () => {
  const html = renderMarkdown('## Notes\n\n## Notes');
  const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['notes', 'notes-1']);
});

test('syntax highlighting is applied', () => {
  const html = renderMarkdown('```js\nconst x = 1;\n```');
  assert.match(html, /<pre class="hljs" data-lang="js"/);
  assert.match(html, /hljs-keyword/);
});

test('ascii fences render in the pixel block', () => {
  const html = renderMarkdown('```ascii\n+---+\n| A |\n```');
  assert.match(html, /<pre class="ascii-art"/);
  assert.ok(html.includes('+---+'));
});

test('unknown languages fall back to escaped text', () => {
  const html = renderMarkdown('```nope\n<script>x</script>\n```');
  assert.match(html, /<pre class="hljs"><code>/);
  assert.ok(!html.includes('<script>x</script>'), 'raw html must be escaped');
});

test('images become lazy and get alt fallbacks', () => {
  const html = renderMarkdown('![a cat](/cat.png)');
  assert.match(html, /loading="lazy"/);
  assert.match(html, /alt="a cat"/);
  assert.match(html, /retro-img/);
});

test('external links are marked noopener', () => {
  const html = renderMarkdown('[x](https://example.com)');
  assert.match(html, /rel="noopener"/);
  const internal = renderMarkdown('[y](/posts/x)');
  assert.ok(!internal.includes('rel="noopener"'), 'internal links stay plain');
});

test('==highlight== and shortcodes are supported', () => {
  assert.match(renderMarkdown('==wow=='), /<mark>wow<\/mark>/);
  assert.match(renderMarkdown('hello :wave:'), /class="shortcode"/);
});

test('++ctrl+k++ becomes real kbd elements', () => {
  const html = renderMarkdown('Press ++ctrl+k++ now');
  assert.match(html, /<kbd>ctrl<\/kbd>\+<kbd>k<\/kbd>/);
});

test('raw HTML passes through (it is a 1990s blog)', () => {
  const html = renderMarkdown('<marquee>hi</marquee>');
  assert.match(html, /<marquee>hi<\/marquee>/);
});

test('splitAtMore honours the more marker', () => {
  const { teaser, rest } = splitAtMore('intro text\n\n<!-- more -->\n\nrest of it');
  assert.equal(teaser, 'intro text');
  assert.equal(rest, 'rest of it');
});

test('splitAtMore falls back to the first heading', () => {
  const intro = 'A reasonably long opening paragraph. '.repeat(8);
  const { teaser, rest } = splitAtMore(intro + '\n\n## Section\n\nbody');
  assert.match(teaser, /reasonably long opening/);
  assert.match(rest, /## Section/);
});

test('toPlainText produces readable text without markdown syntax', () => {
  const text = toPlainText('---\ntitle: x\n---\n\n# Title\n\n**bold** and [link](https://x.test)\n\n<!-- more -->\n\n- item');
  assert.ok(!text.includes('#'), 'heading marker left behind: ' + text);
  assert.ok(!text.includes('**'), 'bold markers left behind');
  assert.ok(!text.includes('<!--'), 'comment left behind');
  assert.match(text, /Title/);
  assert.match(text, /link <https:\/\/x.test>/);
  assert.match(text, /\* item/);
});

test('toPlainText keeps code blocks readable', () => {
  const text = toPlainText('```js\nconst a = 1;\n```');
  assert.match(text, /const a = 1;/);
  assert.ok(!text.includes('```'), 'fence markers left behind');
});

test('excerpt strips markdown before truncating', () => {
  const out = excerpt('## Heading\n\nSome **bold** words here.', 40);
  assert.ok(!out.includes('**'), 'markdown leaked: ' + out);
  assert.ok(out.length <= 40);
});

test('buildToc collects h2-h4 only', () => {
  const html = renderMarkdown('## One\n\n### Two\n\n#### Three\n\n##### Four');
  const toc = buildToc(html);
  assert.deepEqual(toc.map((h) => h.level), [2, 3, 4]);
  assert.deepEqual(toc.map((h) => h.id), ['one', 'two', 'three']);
});

test('createRenderer can be instantiated per site', () => {
  const md = createRenderer({ linkify: false });
  assert.ok(md.render('plain').includes('<p>plain</p>'));
});
