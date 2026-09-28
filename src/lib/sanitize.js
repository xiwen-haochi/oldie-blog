/**
 * Allowlist HTML sanitizer.
 *
 * Markdown already allows raw HTML (a 1990s blog should), which means pasted
 * <style>, inline backgrounds and stray <script> tags can take over the page.
 * This runs on the *rendered* HTML: known-good tags survive with a filtered
 * attribute set, everything else is dropped or escaped.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li', 'main', 'mark', 'nav', 'ol',
  'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'source',
  'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'time', 'tr', 'u', 'ul', 'var', 'video', 'wbr',
  // inline svg is genuinely useful for diagrams pasted from a docs page
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect', 'text',
  'tspan', 'defs', 'marker', 'use', 'symbol', 'clipPath', 'linearGradient', 'stop', 'title',
]);

/** Tags we drop along with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'link', 'meta', 'base', 'object', 'embed', 'form', 'input',
  'button', 'select', 'option', 'textarea', 'iframe', 'frame', 'frameset', 'noscript',
  'template', 'slot', 'portal',
]);

/** Attributes allowed on any element. */
const GLOBAL_ATTRS = new Set([
  'id', 'class', 'title', 'dir', 'lang', 'role', 'alt', 'width', 'height',
  'colspan', 'rowspan', 'scope', 'headers', 'datetime', 'cite', 'start', 'reversed', 'value',
  'loading', 'decoding', 'open', 'controls', 'loop', 'muted', 'playsinline', 'preload', 'kind',
  'viewBox', 'preserveAspectRatio', 'xmlns', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r',
  'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-rule', 'clip-rule', 'font-size',
  'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'offset', 'stop-color',
  'stop-opacity', 'gradientUnits', 'patternUnits', 'markerWidth', 'markerHeight', 'orient',
  'refX', 'refY', 'spreadMethod', 'vector-effect', 'shape-rendering', 'textLength',
]);

/** Per-tag extras. */
const TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel', 'download', 'hreflang', 'type']),
  img: new Set(['src', 'srcset', 'sizes', 'usemap']),
  video: new Set(['src', 'poster', 'width', 'height']),
  audio: new Set(['src']),
  source: new Set(['src', 'srcset', 'type', 'media']),
  td: new Set(['colspan', 'rowspan', 'headers', 'align', 'valign']),
  th: new Set(['scope', 'colspan', 'rowspan', 'align']),
  ol: new Set(['start', 'reversed', 'type']),
  li: new Set(['value']),
  time: new Set(['datetime']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
  del: new Set(['cite', 'datetime']),
  ins: new Set(['cite', 'datetime']),
  data: new Set(['value']),
  details: new Set(['open']),
};

const SAFE_URL = /^(https?:|mailto:|tel:|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);|#|\/|\.)/i;
const DANGEROUS_CSS = /(expression|javascript:|behaviou?r\s*:|-moz-binding|@import|url\s*\(\s*['"]?\s*javascript)/i;

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

/** Keep a small, sane subset of inline CSS (colours, spacing, text). */
function filterStyle(value) {
  const parts = String(value).split(';');
  const kept = [];
  for (const part of parts) {
    const prop = (part.split(':')[0] || '').trim().toLowerCase();
    if (!prop) continue;
    if (!/^(color|font|font-size|font-weight|font-style|font-family|text-align|text-decoration|line-height|letter-spacing|margin|margin-top|margin-bottom|margin-left|margin-right|padding|padding-top|padding-bottom|padding-left|padding-right|border|border-radius|width|max-width|height|min-height|vertical-align|display|white-space|word-break|overflow|opacity|flex|gap|list-style|table-layout|border-collapse|border-spacing)$/.test(prop)) continue;
    if (DANGEROUS_CSS.test(part)) continue;
    kept.push(part.trim());
  }
  return kept.join(';');
}

function safeUrl(value) {
  const raw = String(value || '').trim().replace(/[\u0000-\u001f]/g, '');
  return SAFE_URL.test(raw) ? raw : '';
}

function cleanAttrs(tag, attrString) {
  const allowed = TAG_ATTRS[tag] || null;
  const out = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrString || '')) !== null) {
    const name = m[1];                       // keep the original spelling: SVG needs it
    const lower = name.toLowerCase();
    let value = m[2] === undefined ? '' : m[2].replace(/^["']|["']$/g, '');
    if (lower.startsWith('on')) continue;                // every event handler
    if (lower === 'style') {
      const css = filterStyle(value);
      if (css) out.push('style="' + css + '"');
      continue;
    }
    if (lower === 'href' || lower === 'src' || lower === 'poster' || lower === 'cite' || lower === 'srcset') {
      const url = safeUrl(value);
      if (url) out.push(name + '="' + url + '"');
      continue;
    }
    if (lower === 'target') {
      out.push('target="_blank"');
      continue;
    }
    if (name === 'rel' || !allowed) {
      if (GLOBAL_ATTRS.has(name) || GLOBAL_ATTRS.has(lower) || (allowed && (allowed.has(name) || allowed.has(lower)))) {
        if (lower === 'rel') {
          out.push('rel="noopener noreferrer"');
        } else {
          out.push(name + '="' + String(value).replace(/"/g, '&quot;') + '"');
        }
      }
      continue;
    }
    out.push(name + '="' + String(value).replace(/"/g, '&quot;') + '"');
  }
  // a link that opens a new tab must not hand over window.opener
  if (tag === 'a' && out.some((a) => a.startsWith('target=')) && !out.some((a) => a.startsWith('rel='))) {
    out.push('rel="noopener noreferrer"');
  }
  return out.join(' ');
}

/**
 * @param {string} html  rendered HTML from markdown-it
 * @param {{ stripDangerousTags?: boolean }} [opts]
 */
export function sanitizeHtml(html, opts = {}) {
  if (!html) return '';
  let out = String(html);
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  // 1. drop dangerous elements *and their content* first
  for (const tag of DROP_WITH_CONTENT) {
    out = out.replace(new RegExp('<' + tag + '(\\s[^>]*)?>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), '');
    out = out.replace(new RegExp('<' + tag + '(\\s[^>]*)?\\/?>', 'gi'), '');
  }

  // 2. rewrite every remaining tag against the allowlist
  out = out.replace(TAG_RE, (full, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    const closing = full.startsWith('</');
    const selfClosing = /\/\s*>$/.test(full) && !closing;
    if (closing) return '</' + tag + '>';
    const kept = cleanAttrs(tag, attrs);
    return '<' + tag + (kept ? ' ' + kept : '') + (selfClosing ? ' /' : '') + '>';
  });

  // 3. stray angle brackets that were not part of a tag
  out = out.replace(/<(?![a-zA-Z/!])/g, '&lt;');

  if (opts.stripDangerousTags !== false) {
    out = out.replace(/javascript:/gi, '');
  }
  return out;
}

/** Text-only helpers used by the admin preview and the AI summary. */
export function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export { ALLOWED_TAGS, filterStyle, safeUrl };
