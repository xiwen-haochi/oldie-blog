/**
 * One-time import. An install that predates the single database still has its
 * old files on disk: data/*.json for the runtime stores, and Markdown files in
 * content/. On the first boot they are taken into data/oldie.sqlite and the
 * originals are left exactly where they were, so nothing is ever lost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sqliteNames, sqlitePut, sqliteGet, sqliteKeysWith, sqliteWrittenAt } from './db.js';
import { SETTINGS_KEY } from './config.js';

const RUNTIME_STORES = ['stats', 'guestbook', 'subscribers', 'sessions'];

/** Parse a Markdown file into the same shape the database rows use. */
function readMarkdown(file, kind) {
  const raw = fs.readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    return { kind, slug: path.basename(file).replace(/\.md$/, ''), frontMatter: {}, body: raw };
  }
  const frontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\[.*\]$/.test(value)) {
      value = value.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    frontMatter[kv[1]] = value;
  }
  // A pin carries a time, and a hand-written one often has no featuredAt.
  // Stamp it with the publish date so the newest pin really does come first,
  // instead of guessing on every request.
  if (frontMatter.featured === true && !frontMatter.featuredAt && frontMatter.date) {
    frontMatter.featuredAt = new Date(frontMatter.date + 'T00:00:00.000Z').toISOString();
  }
  return {
    kind,
    slug: path.basename(file).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
    frontMatter,
    body: raw.slice(match[0].length),
  };
}

/**
 * Give every document a creation stamp, once.
 *
 * Posts written before createdAt existed have none, and two of them sharing
 * a publish date were then ordered by their titles -- so the one you had just
 * finished sat at the bottom. The row's own updated_at is the only record of
 * when they were written that anyone kept. It is a guess for a document that
 * was edited after it was created, and a correct one for everything else;
 * a document that already has a stamp is never touched, so this runs once and
 * then never again.
 */
function stampCreationTimes() {
  let stamped = 0;
  // sqliteKeysWith hands back the key without its prefix, which is no use
  // here: the row has to be read under its full name.
  const names = sqliteNames().filter((n) => n.startsWith('post:') || n.startsWith('page:'));
  for (const name of names) {
    const doc = sqliteGet(name, null);
    if (!doc || doc.createdAt) continue;
    doc.createdAt = sqliteWrittenAt(name) || new Date().toISOString();
    sqlitePut(name, doc);
    stamped++;
  }
  return stamped;
}

export function importExistingData({ dataDir, root }) {
  const migrated = [];
  const existing = new Set(sqliteNames());

  for (const name of RUNTIME_STORES) {
    const file = path.join(dataDir, name + '.json');
    if (!fs.existsSync(file) || existing.has(name)) continue;
    try {
      sqlitePut(name, JSON.parse(fs.readFileSync(file, 'utf8')));
      migrated.push({ name });
    } catch {
      /* a broken file is left alone rather than lost */
    }
  }

  // settings.json is what the admin used to write; the bootstrap file stays
  const settingsFile = path.join(dataDir, 'settings.json');
  if (fs.existsSync(settingsFile) && !existing.has(SETTINGS_KEY)) {
    try {
      sqlitePut(SETTINGS_KEY, JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
      migrated.push({ name: 'settings.json' });
    } catch {
      /* ignore */
    }
  }

  if (root) {
    for (const [kind, dir] of [['post', path.join(root, 'content', 'posts')], ['page', path.join(root, 'content', 'pages')]]) {
      const prefix = kind + ':';
      if (sqliteKeysWith(prefix).length) continue;
      let names = [];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
      } catch {
        continue;
      }
      let count = 0;
      for (const name of names) {
        try {
          const file = path.join(dir, name);
          const doc = readMarkdown(file, kind);
          // Stamp creation from the file's own mtime. Two .md files carrying
          // the same date used to be ordered by their titles, and the mtime is
          // the only honest record of which one was written first.
          doc.createdAt = new Date(fs.statSync(file).mtimeMs).toISOString();
          sqlitePut(prefix + doc.slug, doc);
          count++;
        } catch {
          /* skip an unreadable file rather than abort the import */
        }
      }
      if (count) migrated.push({ name: count + ' ' + kind + (count === 1 ? '' : 's') });
    }
  }

  return { migrated, stamped: stampCreationTimes() };
}

/** Everything in the database, as plain objects. Used by the backup export. */
export function exportDatabase() {
  const out = {};
  for (const name of sqliteNames()) {
    if (name.includes(':')) {
      // articles are stored one key per document, with a namespace
      const [namespace, ...rest] = name.split(':');
      (out[namespace] = out[namespace] || {})[rest.join(':')] = sqliteGet(name, null);
    } else {
      out[name] = sqliteGet(name, null);
    }
  }
  return out;
}
