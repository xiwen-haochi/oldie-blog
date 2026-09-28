import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, sanitizeSvgStyle } from '../src/lib/sanitize.js';

const diagram = [
  '<svg viewBox="0 0 400 200">',
  '  <style>.box{fill:#eef3ff;stroke:#3355ff} .label{font-size:14px;fill:#123}</style>',
  '  <rect class="box" x="10" y="10" width="120" height="40"/>',
  '  <text class="label" x="20" y="35">你输入</text>',
  '</svg>',
].join('');

test('an inline svg keeps its own stylesheet, so boxes are not black', () => {
  const html = sanitizeHtml(diagram);
  assert.match(html, /<style>/, 'the svg stylesheet must survive');
  assert.match(html, /fill:#eef3ff/, 'the fill rule must survive');
  assert.match(html, /class="box"/);
  assert.match(html, /你输入/);
});

test('page-level stylesheets are still dropped', () => {
  const html = sanitizeHtml('<style>.box{fill:#eef3ff}</style><div class="box">x</div>');
  assert.ok(!html.includes('<style'), 'a stylesheet outside an svg must not survive');
});

test('an svg stylesheet cannot reach the page', () => {
  assert.equal(sanitizeSvgStyle('body{background:red}'), '');
  assert.equal(sanitizeSvgStyle('*{display:none}'), '');
  assert.equal(sanitizeSvgStyle(':root{--x:1}'), '');
  assert.equal(sanitizeSvgStyle('@import url(https://evil.test/x.css)'), '');
  assert.equal(sanitizeSvgStyle('rect{fill:url(javascript:alert(1))}'), '');
  assert.match(sanitizeSvgStyle('rect{fill:#fff}'), /rect \{ fill:#fff \}/);
  assert.match(sanitizeSvgStyle('text.label{fill:#123}'), /svg text\.label/);
  // a bare class would match a div on the page, so it gets pinned to the svg
  assert.match(sanitizeSvgStyle('.box{fill:#eee}'), /^svg \.box \{/);
});

test('scripts inside an svg are still removed', () => {
  const html = sanitizeHtml('<svg><style>.a{fill:#fff}</style><script>alert(1)</script><rect class="a"/></svg>');
  assert.ok(!html.includes('<script'));
  assert.match(html, /<style>/);
});