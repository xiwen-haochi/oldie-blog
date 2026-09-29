import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIEWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'views');

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ejs')) out.push(full);
  }
  return out;
}

const templates = walk(VIEWS);

/** Tags that must balance; void elements are deliberately absent. */
const PAIRED = [
  'div', 'form', 'span', 'a', 'section', 'main', 'aside', 'header', 'footer',
  'nav', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'label', 'fieldset', 'legend', 'textarea', 'select', 'option', 'pre',
  'h1', 'h2', 'h3', 'h4', 'details', 'p', 'figure', 'figcaption', 'article',
];

/** Strip EJS so we only count real markup. */
function markupOnly(src) {
  return src
    .replace(/<%[=-]?[\s\S]*?%>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
}

test('every POST form carries a CSRF field', () => {
  const offenders = [];
  for (const file of templates) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<form[^>]*method="post"[^>]*>([\s\S]*?)<\/form>/g)) {
      const action = (m[0].match(/action="([^"]*)"/) || [])[1] || '?';
      if (!m[1].includes('_csrf')) offenders.push(path.relative(VIEWS, file) + ' -> ' + action);
    }
  }
  assert.deepEqual(offenders, [], 'forms without a _csrf input (they would 403): ' + offenders.join(', '));
});

test('no template is truncated: every tag balances', () => {
  const offenders = [];
  for (const file of templates) {
    const html = markupOnly(fs.readFileSync(file, 'utf8'));
    for (const tag of PAIRED) {
      const open = (html.match(new RegExp('<' + tag + '(\\s|>)', 'gi')) || []).length;
      const close = (html.match(new RegExp('</' + tag + '>', 'gi')) || []).length;
      if (open !== close) {
        offenders.push(path.relative(VIEWS, file) + ' <' + tag + '>: ' + open + ' open / ' + close + ' close');
      }
    }
  }
  assert.deepEqual(offenders, [], 'unbalanced tags (usually a truncated template): ' + offenders.join(' | '));
});

test('no template has a dangling attribute', () => {
  const offenders = [];
  for (const file of templates) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('="<%=') && (line.match(/"/g) || []).length % 2 !== 0) {
        offenders.push(path.relative(VIEWS, file) + ':' + (i + 1) + ' odd number of quotes');
      }
    });
  }
  assert.deepEqual(offenders, [], offenders.join(' | '));
});

test('no template references an identifier the routes may not send', () => {
  // the editor is rendered by six different routes; keep the risky one honest
  const editor = fs.readFileSync(path.join(VIEWS, 'admin', 'editor.ejs'), 'utf8');
  assert.match(editor, /typeof originalSlug === 'undefined'/, 'editor must guard originalSlug');
  assert.match(editor, /typeof isNew === 'undefined'/, 'editor must guard isNew');
});

test('the photo filter menu and the whitelist cannot drift apart', async () => {
  // The options are spelled out in the template so every label is a literal
  // t() key, which means the list exists twice on purpose. This is the pin.
  const { PHOTO_FILTERS } = await import('../src/lib/config.js');
  const form = fs.readFileSync(path.join(VIEWS, 'admin', 'settings.ejs'), 'utf8');
  const inForm = [...form.matchAll(/<option value="([a-z]*)"/g)].map((m) => m[1]).filter(Boolean);
  assert.deepEqual(inForm, PHOTO_FILTERS,
    'the menu offers ' + JSON.stringify(inForm) + ' but the server accepts ' + JSON.stringify(PHOTO_FILTERS));

  const css = fs.readFileSync(path.resolve(VIEWS, '..', '..', 'public', 'css', 'site.css'), 'utf8');
  for (const name of PHOTO_FILTERS) {
    // the token is followed by ] and a brace, not by whitespace
    assert.match(css, new RegExp('data-age="' + name + '"[^{]*\\{[^}]*--photo-filter:'),
      'the ' + name + ' filter has no recipe in the stylesheet');
  }
});
