import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { slugify, stripHtml, truncate, readingTime, escapeHtml } from './text.js';
import { protectRawHtml, restoreRawHtml } from './protect.js';

/**
 * Markdown-It tuned for a 1990s personal homepage:
 *  - raw HTML stays on (marquee / center / table / bgsound are part of the look)
 *  - every heading gets a stable anchor so deep links and the TOC work
 *  - ascii fences render in a pixel-ish pre block
 *  - ==highlight== and :shortcode: are supported out of the box
 */
export function createRenderer({ linkify = true, typographer = true } = {}) {
  const md = new MarkdownIt({
    html: true,
    linkify,
    typographer,
    breaks: false,
    highlight(str, lang) {
      const language = (lang || '').trim().split(/\s+/)[0];
      if (language && hljs.getLanguage(language)) {
        try {
          const out = hljs.highlight(str, { language, ignoreIllegals: true });
          return `<pre class="hljs" data-lang="${escapeHtml(language)}"><code>${out.value}</code></pre>`;
        } catch { /* fall through to escaped text */ }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    },
  });

  md.use((m) => {
    m.core.ruler.push('oldie_heading_anchors', (state) => {
      const seen = new Map();
      const slugs = new Set();
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length; i++) {
        const open = tokens[i];
        if (open.type !== 'heading_open') continue;
        const inline = tokens[i + 1];
        if (!inline) continue;
        const text = inline.content || 'section';
        let base = slugify(text) || 'section';
        const n = seen.get(base) || 0;
        seen.set(base, n + 1);
        if (n) base = base + '-' + n;
        while (slugs.has(base)) base += '-x';
        slugs.add(base);
        open.attrSet('id', base);
        const anchor = new state.Token('html_inline', '', 0);
        anchor.content = '<a class="anchor" href="#' + base + '" aria-label="Permalink">#</a>';
        if (inline.children) inline.children.push(anchor);
      }
      return true;
    });

    const defaultLinkOpen =
      md.renderer.rules.link_open ||
      ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const href = tokens[idx].attrGet('href') || '';
      const origin = (env && env.siteOrigin) || '';
      if (/^https?:\/\//i.test(href) && (!origin || !href.startsWith(origin))) {
        tokens[idx].attrSet('rel', 'noopener');
        tokens[idx].attrSet('class', ((tokens[idx].attrGet('class') || '') + ' ext').trim());
      }
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    const defaultImage = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      token.attrSet('loading', 'lazy');
      token.attrSet('decoding', 'async');
      if (!token.attrGet('alt')) token.attrSet('alt', token.content || '');
      const html = defaultImage
        ? defaultImage(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options);
      return '<span class="retro-img">' + html + '</span>';
    };

    // ++ctrl+k++ -> <kbd>ctrl</kbd>+<kbd>k</kbd>
    // the terminator is what makes markdown-it's text rule stop scanning at '+'
    const oldieKbd = (state, silent) => {
      const m = /^\+\+(.+?)\+\+/.exec(state.src.slice(state.pos, state.posMax));
      if (!m) return false;
      const parts = m[1].split(/([+-])/).filter((x) => x !== '');
      if (!silent) {
        const token = state.push('html_inline', '', 0);
        token.content = parts
          .map((part) => (part === '+' || part === '-' ? part : '<kbd>' + escapeHtml(part.trim()) + '</kbd>'))
          .join('');
      }
      state.pos += m[0].length;
      return true;
    };
    oldieKbd.terminator = '+';
    md.inline.ruler.before('emphasis', 'oldie_kbd', oldieKbd);

    md.inline.ruler.before('emphasis', 'oldie_mark', (state, silent) => {
      const src = state.src;
      const pos = state.pos;
      if (src[pos] !== '=' || src[pos + 1] !== '=') return false;
      const end = src.indexOf('==', pos + 2);
      if (end < 0) return false;
      if (!silent) {
        const token = state.push('html_inline', '', 0);
        token.content = '<mark>' + md.utils.escapeHtml(src.slice(pos + 2, end)) + '</mark>';
      }
      state.pos = end + 2;
      return true;
    });

    md.inline.ruler.after('emphasis', 'oldie_shortcode', (state, silent) => {
      const m = /^:([a-z0-9_+-]{1,20}):/.exec(state.src.slice(state.pos));
      if (!m) return false;
      if (!silent) {
        const token = state.push('html_inline', '', 0);
        token.content = '<span class="shortcode" title=":' + m[1] + ':">' + escapeHtml(m[1]) + '</span>';
      }
      state.pos += m[0].length;
      return true;
    });
  });

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();
    const body = token.content;
    if (info === 'ascii' || info === 'txt' || info === 'art') {
      return '<pre class="ascii-art" aria-label="ASCII art">' + md.utils.escapeHtml(body) + '</pre>';
    }
    const lang = info.split(/\s+/)[0];
    if (lang && hljs.getLanguage(lang)) {
      try {
        const out = hljs.highlight(body, { language: lang, ignoreIllegals: true });
        return '<pre class="hljs" data-lang="' + escapeHtml(lang) + '"><code>' + out.value + '</code></pre>';
      } catch { /* ignore */ }
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(body) + '</code></pre>';
  };

  return md;
}

let shared = null;
export function md() {
  if (!shared) shared = createRenderer();
  return shared;
}

export function renderMarkdown(source = '', options = {}) {
  const text = String(source == null ? '' : source);
  // pasted HTML with blank lines inside it would otherwise be chopped into
  // markdown paragraphs (and indented bits turned into code blocks)
  const guarded = protectRawHtml(text);
  return restoreRawHtml(md().render(guarded.html, options), guarded.map);
}

/** <!-- more --> splits the teaser from the rest of the post. */
export function splitAtMore(source = '') {
  const raw = String(source == null ? '' : source);
  const idx = raw.search(/^\s*(?:<!--\s*more\s*-->|\*\*\*|\.\.\.)\s*$/m);
  if (idx === -1) {
    const h2 = raw.search(/^##\s+/m);
    if (h2 > 200) return { teaser: raw.slice(0, h2).trim(), rest: raw.slice(h2).trim() };
    return { teaser: raw.trim(), rest: '' };
  }
  const marker = raw.slice(idx).match(/^\s*(?:<!--\s*more\s*-->|\*\*\*|\.\.\.)\s*$/m);
  return {
    teaser: raw.slice(0, idx).trim(),
    rest: raw.slice(idx + (marker ? marker[0].length : 0)).trim(),
  };
}

export function excerpt(source = '', length = 180) {
  return truncate(toPlainText(splitAtMore(source).teaser), length);
}

const FENCE_RE = new RegExp('^' + String.fromCharCode(96).repeat(3) + '[\\s\\S]*?' + String.fromCharCode(96).repeat(3), 'g');
const FENCE_TAG_RE = new RegExp(String.fromCharCode(96).repeat(3) + '\\w*', 'g');
const HASH_RE = /^#{1,6}\s+/gm;
const QUOTE_RE = /^>\s?/gm;
const BULLET_RE = /^[-*+]\s+/gm;

/** Plain-text rendition used by the "DOWNLOAD AS .TXT" button. */
export function toPlainText(source = '') {
  return String(source == null ? '' : source)
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(FENCE_RE, (m) => m.replace(FENCE_TAG_RE, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '[image: $1]')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1 <$2>')
    .replace(HASH_RE, '')
    .replace(QUOTE_RE, '> ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(BULLET_RE, '  * ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildToc(html = '') {
  const toc = [];
  const re = /<h([2-4])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html))) {
    toc.push({ level: Number(m[1]), id: m[2], text: stripHtml(m[3].replace(/<a class="anchor"[\s\S]*$/, '')) });
  }
  return toc;
}

export { readingTime, stripHtml };
