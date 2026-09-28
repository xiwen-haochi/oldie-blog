import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { POSTS_DIR, PAGES_DIR } from './paths.js';
import { slugify } from './text.js';

const FIELD_ORDER = [
  'title', 'slug', 'date', 'updated', 'description', 'tags', 'author', 'cover', 'coverAlt',
  'keywords', 'canonical', 'draft', 'featured', 'noindex', 'lang', 'series', 'audio',
];

const yamlString = (value) => {
  const s = String(value == null ? '' : value);
  if (!s) return '""';
  if (/[:#\[\]{}&*!|>'"%@\u0060]|\n/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
};

const yamlValue = (v) => {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.length ? '[' + v.map(yamlString).join(', ') + ']' : '[]';
  return yamlString(v);
};

/** Deterministic, human-editable front matter — the file stays readable. */
export function frontMatter(fields, body) {
  const lines = ['---'];
  const rest = Object.keys(fields).filter((k) => !FIELD_ORDER.includes(k) && fields[k] !== undefined && fields[k] !== '');
  const keys = [...FIELD_ORDER.filter((k) => fields[k] !== undefined && fields[k] !== ''), ...rest];
  for (const key of keys) lines.push(key + ': ' + yamlValue(fields[key]));
  lines.push('---', '', '');
  return lines.join('\n') + String(body || '').replace(/^\n+/, '');
}

function fileNameFor(fields) {
  const date = new Date(fields.date || Date.now());
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d + '-' + fields.slug + '.md';
}

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
    noindex: on(pick('noindex')),
    lang: String(pick('lang', existing.lang || '') || ''),
    series: String(pick('series', existing.series || '') || ''),
    audio: String(pick('audio', existing.audio || '') || ''),
  };
}

/**
 * Create or update a Markdown file on disk. Markdown stays the source of
 * truth — the admin UI is simply another editor for the same files.
 */
export async function saveDoc({ kind = 'post', slug, fields, body }) {
  const dir = kind === 'post' ? POSTS_DIR : PAGES_DIR;
  await fsp.mkdir(dir, { recursive: true });

  const previous = slug ? findFile(dir, slug) : null;
  const keepName = previous && path.basename(previous.file).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '') === fields.slug;
  const file = keepName ? previous.file : path.join(dir, fileNameFor(fields));

  if (previous && !keepName) await fsp.rm(previous.file, { force: true });
  await fsp.writeFile(file, frontMatter(fields, body), 'utf8');
  return { file: path.basename(file), path: file, created: !previous };
}

export async function deleteDoc({ kind = 'post', slug }) {
  const found = findFile(kind === 'post' ? POSTS_DIR : PAGES_DIR, slug);
  if (!found) return false;
  await fsp.rm(found.file, { force: true });
  return true;
}

export function findFile(dir, slug) {
  const clean = slugify(slug);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const base = name.replace(/\.md$/, '');
    const stripped = base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (slugify(stripped) === clean || slugify(base) === clean) {
      return { file: path.join(dir, name), name };
    }
  }
  return null;
}

/** Raw front matter + body, for the "edit the .md file directly" screen. */
export function rawOf({ kind = 'post', slug }) {
  const found = findFile(kind === 'post' ? POSTS_DIR : PAGES_DIR, slug);
  if (!found) return null;
  const parsed = matter(fs.readFileSync(found.file, 'utf8'));
  return { file: found.name, data: parsed.data, body: String(parsed.content).replace(/^\n+/, '') };
}

export function listFiles(kind = 'post') {
  const dir = kind === 'post' ? POSTS_DIR : PAGES_DIR;
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !n.startsWith('_'));
  } catch {
    return [];
  }
}
