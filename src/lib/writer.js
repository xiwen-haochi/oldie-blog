import { sqliteGet, sqlitePut, sqliteDelete, sqliteKeysWith } from './db.js';
import { slugify } from './text.js';

/** Normalise whatever the editor sent into the shape a document stores. */
export function normaliseFields(input = {}, existing = {}) {
  const pick = (k, fallback = '') => (input[k] === undefined ? fallback : input[k]);
  const on = (v) => v === 'on' || v === true || v === 'true' || v === '1';
  const toArray = (v) => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    return String(v === undefined || v === null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean);
  };
  return {
    title: String(pick('title', existing.title) || 'Untitled').trim().slice(0, 200),
    slug: slugify(pick('slug') || pick('title', existing.slug) || 'untitled'),
    date: String(pick('date', existing.date || new Date().toISOString().slice(0, 10))).slice(0, 10),
    updated: String(pick('updated', '') || '').slice(0, 10),
    description: String(pick('description', existing.description) || '').trim().slice(0, 400),
    tags: toArray(pick('tags', existing.tags)),
    author: String(pick('author', existing.author || '') || ''),
    cover: String(pick('cover', existing.cover || '') || ''),
    coverAlt: String(pick('coverAlt', existing.coverAlt || '') || ''),
    keywords: toArray(pick('keywords', existing.keywords)),
    canonical: String(pick('canonical', existing.canonical || '') || ''),
    draft: on(pick('draft')),
    featured: on(pick('featured')),
    // pin time: what the home page sorts by, so pinning an old post still works
    featuredAt: String(pick('featuredAt', existing.featuredAt || '') || ''),
    noindex: on(pick('noindex')),
    lang: String(pick('lang', existing.lang || '') || ''),
    series: String(pick('series', existing.series || '') || ''),
    audio: String(pick('audio', existing.audio || '') || ''),
  };
}

const PREFIX = { post: 'post:', page: 'page:' };
const key = (kind, slug) => PREFIX[kind] + slugify(slug);

/** The name this document would have on disk, for display and for exports. */
export function fileNameFor(fields) {
  const date = String(fields.date || new Date().toISOString().slice(0, 10));
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '0000-00-00';
  return d + '-' + fields.slug + '.md';
}

const FIELD_ORDER = [
  'title', 'slug', 'date', 'updated', 'description', 'tags', 'author', 'cover', 'coverAlt',
  'keywords', 'canonical', 'draft', 'featured', 'featuredAt', 'noindex', 'lang', 'series', 'audio',
];

const yamlString = (value) => {
  const s = String(value == null ? '' : value);
  if (!s) return '""';
  if (/[:#\[\]{}&*!|>'"%@\u0060]|\n/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
};

const yamlValue = (v) => {
  if (Array.isArray(v)) return '[' + v.map((x) => yamlString(x)).join(', ') + ']';
  if (typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '""';
  return yamlString(v);
};

/** The export form: a real Markdown file with real YAML front matter. */
export function frontMatter(fields, body) {
  const lines = ['---'];
  for (const name of FIELD_ORDER) {
    if (!(name in fields)) continue;
    const value = fields[name];
    // empty is worth nothing in an export, but false and 0 are answers
    if (value === '' || value === null || value === undefined) continue;
    if (Array.isArray(value) && !value.length) continue;
    lines.push(name + ': ' + yamlValue(value));
  }
  lines.push('---', '', String(body || '').replace(/^\n+/, ''));
  return lines.join('\n');
}

/**
 * Create or update a document. Markdown in, a row in the database out; the
 * front matter is kept as a parsed object rather than text, which is the whole
 * point of not writing files any more.
 */
export async function saveDoc({ kind = 'post', slug, fields, body, createdAt }) {
  const previous = slug ? readDoc({ kind, slug }) : null;
  const doc = {
    kind,
    slug: fields.slug,
    frontMatter: { ...fields },
    body: String(body || ''),
    // When this was written, stamped once and never moved. Two posts published
    // on the same day used to be ordered by their titles, because the publish
    // date is all there was. An edit must not count as a fresh post: fixing a
    // typo in an old article is not new writing.
    createdAt: (previous && previous.createdAt) || createdAt || new Date().toISOString(),
  };
  if (previous && previous.slug !== fields.slug) sqliteDelete(key(kind, previous.slug));
  sqlitePut(key(kind, fields.slug), doc);
  return { file: fileNameFor(fields), key: key(kind, fields.slug), created: !previous };
}

export async function deleteDoc({ kind = 'post', slug }) {
  const found = readDoc({ kind, slug });
  if (!found) return false;
  sqliteDelete(key(kind, slug));
  return true;
}

/** The stored document, or null. */
export function readDoc({ kind = 'post', slug }) {
  const clean = slugify(slug);
  if (!clean) return null;
  return sqliteGet(key(kind, clean), null);
}

export function docExists({ kind = 'post', slug }) {
  return Boolean(readDoc({ kind, slug }));
}

/** Front matter + body, which is what the editor needs. */
export function rawOf({ kind = 'post', slug }) {
  const doc = readDoc({ kind, slug });
  if (!doc) return null;
  return {
    file: fileNameFor({ date: doc.frontMatter.date, slug: doc.slug }),
    data: doc.frontMatter,
    body: String(doc.body || '').replace(/^\n+/, ''),
  };
}

export function listFiles(kind = 'post') {
  return sqliteKeysWith(PREFIX[kind] || PREFIX.post)
    .filter((slug) => !slug.startsWith('_'))
    .map((slug) => fileNameFor({ date: sqliteGet(key(kind, slug), { frontMatter: {} }).frontMatter?.date, slug }));
}

/** Every stored document of a kind, for the index. */
export function listDocs(kind = 'post') {
  return sqliteKeysWith(PREFIX[kind] || PREFIX.post)
    .map((slug) => sqliteGet(key(kind, slug), null))
    .filter(Boolean);
}
