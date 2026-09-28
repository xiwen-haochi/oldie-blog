import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeHtml, stripTags, safeUrl, filterStyle } from '../src/lib/sanitize.js';
import { renderMarkdown } from '../src/lib/markdown.js';

test('pasted content that breaks a page is neutralised', () => {
  const html = sanitizeHtml([
    '<style>body{background:#ff0}</style>',
    '<div style="background:yellow;position:fixed;top:0;width:100%">被污染的背景</div>',
    '<script>alert(1)</script>',
    '<iframe src="https://evil.test"></iframe>',
    '<form action="/steal"><input name="a"></form>',
  ].join('\n'));

  assert.ok(!html.includes('<style'), 'style tag must go');
  assert.ok(!html.includes('background:yellow'), 'inline background must go');
  assert.ok(!html.includes('position:fixed'), 'fixed positioning must go');
  assert.ok(!html.includes('<script'), 'script must go');
  assert.ok(!html.includes('<iframe'), 'iframe must go');
  assert.ok(!html.includes('<form'), 'form must go');
  assert.ok(!html.includes('<input'), 'input must go');
});

test('event handlers and javascript: urls never survive', () => {
  const html = sanitizeHtml([
    '<a href="javascript:alert(1)" onclick="steal()">点我</a>',
    '<img src="/ok.png" onerror="alert(1)" alt="图">',
    '<p onmouseover="x()">文字</p>',
  ].join(''));
  assert.ok(!/on[a-z]+=/i.test(html), 'no on* attributes: ' + html);
  assert.ok(!html.includes('javascript:'), 'no javascript: urls');
  assert.match(html, /href="\/ok\.png"|src="\/ok\.png"/);
});

test('safe formatting html survives', () => {
  const html = sanitizeHtml('<p class="note" style="color:#333;text-align:center">居中说明</p>');
  assert.match(html, /class="note"/);
  assert.match(html, /color:#333/);
  assert.match(html, /居中说明/);
});

test('links that open a new tab get rel=noopener', () => {
  const html = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
  assert.match(html, /rel="noopener noreferrer"/);
});

test('media elements and their attributes are kept', () => {
  const html = sanitizeHtml('<video controls poster="/p.jpg"><source src="/v.mp4" type="video/mp4"></video>');
  assert.match(html, /<video/);
  assert.match(html, /poster="\/p\.jpg"/);
  assert.match(html, /src="\/v\.mp4"/);
});

test('inline svg (pasted diagrams) is kept, its scripts are not', () => {
  const html = sanitizeHtml('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#0f0"/><script>alert(1)</script></svg>');
  assert.match(html, /<svg/);
  assert.match(html, /viewBox="0 0 10 10"/);
  assert.match(html, /<rect/);
  assert.ok(!html.includes('<script'));
});

test('tables and cells survive', () => {
  const html = sanitizeHtml('<table><thead><tr><th colspan="2">标题</th></tr></thead><tbody><tr><td>一</td><td>二</td></tr></tbody></table>');
  assert.match(html, /<th colspan="2">/);
  assert.match(html, /<td>一<\/td>/);
});

test('data: image urls are allowed, data:text/html is not', () => {
  assert.equal(safeUrl('data:image/png;base64,iVBOR'), 'data:image/png;base64,iVBOR');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('/uploads/x.png'), '/uploads/x.png');
  assert.equal(safeUrl('https://cdn.test/a.png'), 'https://cdn.test/a.png');
});

test('style filtering keeps layout, drops behaviour', () => {
  assert.equal(filterStyle('color:red;behavior:url(x.htc)'), 'color:red');
  assert.equal(filterStyle('background:url(javascript:alert(1))'), '');
  assert.equal(filterStyle('position:fixed'), '');
});

test('stripTags flattens to text', () => {
  assert.equal(stripTags('<p>你好 <b>世界</b></p>'), '你好 世界');
  assert.equal(stripTags('<script>bad()</script>ok'), 'ok');
});

test('markdown keeps raw html blocks that contain blank lines', () => {
  const src = '前文\n\n<div class="fig">\n  <span>第一行</span>\n\n  <span>第二行</span>\n</div>\n\n后文 **加粗**。';
  const html = renderMarkdown(src);
  assert.match(html, /<div class="fig">/);
  assert.match(html, /第一行/);
  assert.match(html, /第二行/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.ok(!html.includes('<pre'), 'nothing should be demoted into a code block');
});

test('a full post pipeline is safe end to end', () => {
  const html = sanitizeHtml(renderMarkdown('正常文字\n\n<div style="background:#ff0" onclick="x()">图文</div>'));
  assert.match(html, /图文/);
  assert.ok(!html.includes('#ff0'));
  assert.ok(!/onclick/i.test(html));
});
