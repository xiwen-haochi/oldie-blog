import { listDocs } from './writer.js';
import { renderMarkdown, splitAtMore, excerpt, toPlainText, buildToc } from './markdown.js';
import { sanitizeHtml } from './sanitize.js';
import { slugify, readingTime, stripHtml, countWords } from './text.js';

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const toBool = (v) => (typeof v === 'boolean' ? v : String(v ?? '').toLowerCase() === 'true');

/**
 * When a post was pinned. A pin without a stamp — a hand-edited front matter, an
 * import — falls back to the publish date, because that is the only time we
 * actually know about.
 */
/**
 * When a post was written. The creation stamp, or the publish date for the
 * posts that predate it -- which is every post written before this field
 * existed, and a newly imported .md until it is saved once.
 */
function writtenAt(post) {
  return post.createdAt || post.date;
}

/**
 * Newest first, and within a single day the one written last. This was the
 * index's base order with a title tiebreak, so three articles published on the
 * same afternoon came back A, B, C no matter which one you finished last.
 */
function byNewest(a, b) {
  return b.date - a.date || writtenAt(b) - writtenAt(a) || a.title.localeCompare(b.title);
}

function pinTime(post) {
  return (post.featuredAt || post.date || 0);
}

function coerceDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normaliseTags(input) {
  return [...new Set(asArray(input).map((t) => String(t).trim()).filter(Boolean))];
}

/**
 * Turn one markdown file into the shape templates consume.
 * Filenames may carry the date (2025-03-14-hello.md) or not (hello.md).
 */
export function parseDoc(stored, { kind = 'post', siteOrigin = '' } = {}) {
  const data = (stored && stored.frontMatter) || {};
  const content = String((stored && stored.body) || '');
  const base = String((stored && stored.slug) || 'untitled');
  const rel = (kind === 'page' ? 'pages/' : 'posts/') + base;

  // A standalone page often carries no date. There is no file mtime to fall
  // back on any more, so it becomes "now" — which only ever feeds the meta tags.
  let date = coerceDate(data.date) || new Date();
  const slug = slugify(data.slug || base);

  const body = content.trim();
  const { teaser, rest } = splitAtMore(body);
  // raw HTML is allowed (it is a 1990s blog) but it is filtered against an
  // allowlist, so a pasted <style> or a fixed-position div cannot take over
  const html = sanitizeHtml(renderMarkdown(body, { siteOrigin }));
  const teaserHtml = rest ? renderMarkdown(teaser + '\n\n<!-- more -->', { siteOrigin }) : html;
  const plain = toPlainText(body);
  const words = countWords(plain);
  const tags = normaliseTags(data.tags ?? data.categories ?? data.category);

  const title = String(data.title || slug.replace(/-/g, ' '));
  const description = String(data.description || data.excerpt || excerpt(body, 180));

  return {
    kind,
    slug,
    title,
    file: rel,
    // there is no file any more; the key it lives under is the honest answer
    key: kind + ':' + slug,
    date,
    updated: coerceDate(data.updated) || null,
    // when it was written, not when it was last touched
    createdAt: coerceDate(stored && stored.createdAt) || null,
    tags,
    draft: toBool(data.draft),
    featured: toBool(data.featured),
    featuredAt: coerceDate(data.featuredAt) || null,
    description,
    keywords: asArray(data.keywords),
    cover: data.cover || data.image || '',
    coverAlt: data.coverAlt || data.imageAlt || title,
    author: data.author || '',
    canonical: data.canonical || '',
    noindex: toBool(data.noindex),
    template: data.template || '',
    audio: data.audio || data.bgsound || '',
    lang: data.lang || '',
    series: data.series || '',
    body,
    html,
    teaserHtml,
    plain,
    toc: buildToc(html),
    readingTime: readingTime(plain),
    wordCount: words.total,
    charCount: words.cjk * 2 + words.latin,
    url: kind === 'post' ? `/posts/${slug}` : `/${slug}`,
    txtUrl: kind === 'post' ? `/posts/${slug}.txt` : null,
  };
}

/** The content index, rebuilt from the database on every load. */
export class ContentIndex {
  #watchers = [];
  #timer = null;
  #all = [];
  #version = 0;

  constructor({ siteOrigin = '' } = {}) {
    this.siteOrigin = siteOrigin;
    this.load();
  }

  get version() { return this.#version; }

  /** Everything comes out of the one database; there is no directory to read. */
  load() {
    const read = (kind) =>
      listDocs(kind)
        .filter((doc) => !String(doc.slug || '').startsWith('_') && !String(doc.slug || '').startsWith('.'))
        .map((doc) => {
          try {
            return parseDoc(doc, { kind, siteOrigin: this.siteOrigin });
          } catch (err) {
            console.error('[content] failed to parse', doc.slug, err.message);
            return null;
          }
        })
        .filter(Boolean);

    const posts = read('post');
    const pages = read('page');

    const bySlug = new Map();
    for (const p of posts) bySlug.set(p.slug, p);

    this.#all = [...bySlug.values()].sort(byNewest);
    this.pages = pages.sort((a, b) => a.slug.localeCompare(b.slug));
    this.#version++;

    this.tags = buildTagMap(this.#all);
    return this;
  }


  reload() { return this.load(); }

  allPosts() { return this.#all; }

  posts({ includeDrafts = false } = {}) {
    return includeDrafts ? this.#all : this.#all.filter((p) => !p.draft);
  }

  publishedPosts() { return this.#all.filter((p) => !p.draft); }

  getPost(slug, { includeDrafts = false } = {}) {
    const clean = slugify(slug);
    const post = this.#all.find((p) => p.slug === clean);
    if (!post) return null;
    if (post.draft && !includeDrafts) return null;
    return post;
  }

  getPage(slug) {
    return this.pages.find((p) => p.slug === slugify(slug)) || null;
  }

  /**
   * Pinned posts, most recently pinned first.
   *
   * "Pinned" is a position, not a label, so it has to carry a time. A post pinned
   * by hand-editing its front matter had no featuredAt, and sorting it by
   * publish date is exactly what made pinning look like it had stopped
   * working. A pin with no stamp falls back to the publish date, the only
   * honest guess available.
   */
  featured(limit = Infinity) {
    return this.publishedPosts()
      .filter((p) => p.featured)
      .sort((a, b) => pinTime(b) - pinTime(a))
      .slice(0, limit);
  }

  /**
   * The most recently written posts, newest first.
   *
   * Ordered by when each post was *written*, never by when it was last saved.
   * The home page panel used to be four sentences typed into the template, and
   * the first attempt at this sorted by the updated date -- which meant fixing
   * a typo in a two-year-old article pushed it to the top of the page.
   * A post with no creation stamp falls back to its publish date, which is the
   * only honest thing left to say about it.
   */
  newest(limit = 5) {
    return this.publishedPosts()
      .slice()
      .sort((a, b) => writtenAt(b) - writtenAt(a) || byNewest(a, b))
      .slice(0, limit);
  }

  /**
   * The order every list uses: pinned first, most recently pinned first, then
   * newest first. One place, so the index, the archive and a tag page cannot
   * disagree about what "pinned" means.
   */
  list(opts = {}) {
    const all = opts.includeDrafts ? this.#all : this.publishedPosts();
    return [...all].sort((a, b) => {
      const aPin = a.featured ? pinTime(a) : null;
      const bPin = b.featured ? pinTime(b) : null;
      if (aPin !== bPin) {
        if (!aPin) return 1;
        if (!bPin) return -1;
        const newer = bPin - aPin;
        if (newer) return newer;
      }
      return byNewest(a, b);
    });
  }

  related(post, limit = 4) {
    const tags = new Set(post.tags);
    return this.publishedPosts()
      .filter((p) => p.slug !== post.slug)
      .map((p) => {
        let score = 0;
        for (const t of p.tags) if (tags.has(t)) score += 2;
        if (p.series && p.series === post.series) score += 3;
        return { post: p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.post.date - a.post.date)
      .slice(0, limit)
      .map((x) => x.post);
  }

  neighbours(post) {
    const list = this.publishedPosts();
    const idx = list.findIndex((p) => p.slug === post.slug);
    return {
      newer: idx > 0 ? list[idx - 1] : null,
      older: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
    };
  }

  /** [{ year, count, months: [{ month, count, posts }] }] newest first. */
  timeline() {
    const map = new Map();
    for (const p of this.publishedPosts()) {
      const year = p.date.getUTCFullYear();
      if (!map.has(year)) map.set(year, new Map());
      const months = map.get(year);
      const month = p.date.getUTCMonth() + 1;
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(p);
    }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => ({
        year,
        count: [...months.values()].reduce((n, arr) => n + arr.length, 0),
        months: [...months.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([month, posts]) => ({ month, posts, count: posts.length })),
      }));
  }

  allTags() { return [...this.tags.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)); }

  postsByTag(tag, opts = {}) {
    const t = slugify(tag);
    return this.list(opts).filter((p) => p.tags.some((x) => slugify(x) === t));
  }

  /** Deterministic-ish daily random post (same day → same post for everyone). */
  randomPost(seed = Date.now()) {
    const list = this.publishedPosts();
    if (!list.length) return null;
    const day = Math.floor(seed / 86400000);
    return list[day % list.length];
  }

  totalWords() {
    return this.publishedPosts().reduce((n, p) => n + p.wordCount, 0);
  }

  /** There is nothing on disk to watch any more; reloads happen on save. */
  watch(onChange = () => {}) {
    void onChange;
    return this;
  }

  close() {
    this.#watchers = [];
  }
}

function buildTagMap(posts) {
  const map = new Map();
  for (const post of posts) {
    if (post.draft) continue;
    for (const tag of post.tags) {
      const key = slugify(tag);
      if (!map.has(key)) map.set(key, { name: tag, slug: key, count: 0, posts: [] });
      const entry = map.get(key);
      entry.count++;
      entry.posts.push(post);
    }
  }
  return map;
}

export function paginate(items, page = 1, perPage = 10) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    page: current,
    pages,
    perPage,
    total,
    hasPrev: current > 1,
    hasNext: current < pages,
    prev: current > 1 ? current - 1 : null,
    next: current < pages ? current + 1 : null,
    range: total ? [start + 1, Math.min(start + perPage, total)] : [0, 0],
  };
}

export { buildTagMap, asArray, toBool, coerceDate };