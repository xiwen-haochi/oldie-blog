/**
 * Raw-HTML guard. (The sentinel uses private-use code points: markdown-it
 * normalises NUL to U+FFFD, which would corrupt a NUL-delimited placeholder.)
 *
 * CommonMark ends an HTML block at the first blank line, so a pasted
 * `<div>` that contains blank lines gets shredded: the remainder is parsed as
 * markdown and indented fragments end up inside a `<pre>`. Before rendering we
 * lift balanced HTML blocks out into placeholders and put them back afterwards.
 */

const PLACEHOLDER = '\uE000OLDIEHTML';
const TERMINATOR = '\uE001';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const OPEN_RE = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*?)?\/?>/g;
const CLOSE_RE = /<\/([a-zA-Z][a-zA-Z0-9-]*)>/g;

/** Tags that legitimately appear inline in prose without starting a block. */
const INLINE_OK = new Set(['b', 'i', 'em', 'strong', 'code', 'span', 'a', 'mark', 'kbd', 'sup', 'sub', 'small', 'br', 'img', 'abbr', 'del', 'ins']);

/**
 * @param {string} text markdown source
 * @returns {{ html: string, map: string[] }} the guarded markdown and the
 *          raw blocks we took out, in order
 */
export function protectRawHtml(text) {
  const source = String(text == null ? '' : text);
  const map = [];
  if (!source.includes('<')) return { html: source, map };

  // fenced code blocks are literal: never lift HTML out of them
  const fences = fencedRanges(source);
  const inFence = (index) => fences.some(([from, to]) => index > from && index < to);

  let out = '';
  let cursor = 0;
  OPEN_RE.lastIndex = 0;
  let match;

  while ((match = OPEN_RE.exec(source)) !== null) {
    const tag = match[1].toLowerCase();
    const start = match.index;
    if (start < cursor) continue;
    if (VOID_TAGS.has(tag)) continue;            // handled inline
    // a lone <b> inside a sentence is not a block
    if (inFence(start)) continue;
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const beforeTag = source.slice(lineStart, start);
    if (INLINE_OK.has(tag) && beforeTag.trim() !== '') continue;

    const block = takeBalanced(source, start, tag);
    if (!block) continue;

    out += source.slice(cursor, start);
    out += PLACEHOLDER + map.length + TERMINATOR;
    map.push(block);
    cursor = start + block.length;
    OPEN_RE.lastIndex = cursor;
  }

  out += source.slice(cursor);
  return { html: out, map };
}

/** [from, to) ranges covered by ``` or ~~~ fenced code blocks. */
function fencedRanges(source) {
  const re = /^(?: {0,3})(`{3,}|~{3,})[^\n]*$/gm;
  const ranges = [];
  let open = null;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (open === null) {
      open = { marker: m[1][0], len: m[1].length, from: m.index };
    } else if (m[1][0] === open.marker && m[1].length >= open.len) {
      ranges.push([open.from, m.index + m[0].length]);
      open = null;
    }
  }
  if (open) ranges.push([open.from, source.length]);
  return ranges;
}

function takeBalanced(source, start, tag) {
  if (VOID_TAGS.has(tag)) return null;
  const openRe = new RegExp('<' + tag + '(\\s[^>]*)?>', 'gi');
  const closeRe = new RegExp('<\\/' + tag + '\\s*>', 'gi');
  openRe.lastIndex = start;
  const first = openRe.exec(source);
  if (!first) return null;
  if (/>\s*$/.test(first[0]) && /\/\s*>$/.test(first[0])) {
    return source.slice(start, first.index + first[0].length); // self-closing
  }
  let depth = 0;
  let cursor = start;
  while (cursor < source.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(source);
    const nextClose = closeRe.exec(source);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth--;
    cursor = nextClose.index + nextClose[0].length;
    if (depth === 0) return source.slice(start, cursor);
  }
  return null; // unbalanced: let markdown-it deal with it
}

/** Put the protected blocks back, untouched. */
export function restoreRawHtml(html, map) {
  if (!map || !map.length) return html;
  return String(html).replace(
    new RegExp('<p>' + PLACEHOLDER + '(\\d+)' + TERMINATOR + '</p>|' + PLACEHOLDER + '(\\d+)' + TERMINATOR, 'g'),
    (full, wrapped, bare) => {
      const index = Number(wrapped !== undefined ? wrapped : bare);
      return map[index] !== undefined ? map[index] : '';
    }
  );
}
