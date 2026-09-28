import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { POSTS_DIR, PAGES_DIR, CONTENT_DIR } from './paths.js';
import { renderMarkdown, splitAtMore, excerpt, toPlainText, buildToc } from './markdown.js';
import { slugify, readingTime, stripHtml, countWords } from './text.js';

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})\.md$/i;

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const toBool = (v) => (typeof v === 'boolean' ? v : String(v ?? '').toLowerCase() === 'true');

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
export function parseDoc(filePath, { kind = 'post', siteOrigin = '' } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  const base = path.basename(filePath);
  const rel = path.relative(CONTENT_DIR, filePath).split(path.sep).join('/');

  let date = coerceDate(data.date);
  let slug = data.slug ? slugify(data.slug) : null;
  const withDate = DATE_PREFIX.exec(base);
  const dateOnly = DATE_ONLY.exec(base);
  if (withDate) {
    date = date || coerceDate(`${withDate[1]}-${withDate[2]}-${withDate[3]}T00:00:00Z`);
    slug = slug || slugify(withDate[4]);
  } else if (dateOnly) {
    date = date || coerceDate(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00Z`);
    slug = slug || slugify(base.replace(/\.md$/, '') || data.title);
  }
  if (!date) date = coerceDate(fs.statSync(filePath).mtime) || new Date();
  slug = slug || slugify(base.replace(/\.md$/, '') || data.title);

  const body = content.trim();
  const { teaser, rest } = splitAtMore(body);
  const html = renderMarkdown(body, { siteOrigin });
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
    absFile: filePath,
    date,
    updated: coerceDate(data.updated) || null,
    tags,
    draft: toBool(data.draft),
    featured: toBool(data.featured),
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

/** In-memory content index. Markdown files on disk stay the source of truth. */
export class ContentIndex {
  #watchers = [];
  #timer = null;
  #all = [];
  #version = 0;

  constructor({ postsDir = POSTS_DIR, pagesDir = PAGES_DIR, siteOrigin = '' } = {}) {
    this.postsDir = postsDir;
    this.pagesDir = pagesDir;
    this.siteOrigin = siteOrigin;
    this.load();
  }

  get version() { return this.#version; }

  load() {
    const readDir = (dir, kind) => {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { return []; }
      return names
        .filter((n) => n.endsWith('.md') && !n.startsWith('_') && !n.startsWith('.'))
        .map((n) => {
          try {
            return parseDoc(path.join(dir, n), { kind, siteOrigin: this.siteOrigin });
          } catch (err) {
            console.error('[content] failed to parse', n, err.message);
            return null;
          }
        })
        .filter(Boolean);
    };

    const posts = readDir(this.postsDir, 'post');
    const pages = readDir(this.pagesDir, 'page');

    // Later duplicates of the same slug (e.g. 2025-01-01-x.md and x.md) win.
    const bySlug = new Map();
    for (const p of posts) bySlug.set(p.slug, p);

    this.#all = [...bySlug.values()].sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));
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

  featured(limit = 1) { return this.publishedPosts().filter((p) => p.featured).slice(0, limit); }

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

  postsByTag(tag, { includeDrafts = false } = {}) {
    const t = slugify(tag);
    return (includeDrafts ? this.#all : this.publishedPosts()).filter((p) => p.tags.some((x) => slugify(x) === t));
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

  /** Dev convenience: hot-reload when a file changes on disk. */
  watch(onChange = () => {}) {
    if (process.env.NODE_ENV === 'production' || !this.#watchers.length) {
      for (const dir of [this.postsDir, this.pagesDir]) {
        try {
          const w = fs.watch(dir, { persistent: false }, (_evt, filename) => {
            if (filename && !filename.endsWith('.md')) return;
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => {
              this.reload();
              onChange(filename);
            }, 80);
          });
          this.#watchers.push(w);
        } catch { /* directory may not exist yet */ }
      }
    }
    return this;
  }

  close() {
    for (const w of this.#watchers) w.close();
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
