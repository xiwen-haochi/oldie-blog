import { tokenize, stripHtml, truncate } from './text.js';
import { slugify } from './text.js';

/**
 * A dependency-free search index with the operators people expect:
 *   tag:web-design   "exact phrase"   -exclude   in:title
 * CJK works because tokens include unigrams and bigrams.
 */
export function buildIndex(posts) {
  const docs = posts.map((post) => {
    const fields = {
      title: post.title,
      tags: post.tags.join(' '),
      description: post.description,
      body: post.plain,
    };
    const weights = { title: 10, tags: 6, description: 3, body: 1 };
    const tf = new Map();
    for (const [field, text] of Object.entries(fields)) {
      for (const token of tokenize(text)) {
        tf.set(token, (tf.get(token) || 0) + weights[field]);
      }
    }
    return { post, tf, plain: post.plain, length: post.wordCount + 1 };
  });

  const df = new Map();
  for (const doc of docs) for (const token of doc.tf.keys()) df.set(token, (df.get(token) || 0) + 1);

  return { docs, df, total: docs.length };
}

export function parseQuery(q = '') {
  const terms = [];
  const tags = [];
  const phrases = [];
  const excludes = [];
  const fields = [];
  const rest = String(q).trim();

  const phraseRe = /"([^"]+)"/g;
  let stripped = rest;
  let m;
  while ((m = phraseRe.exec(rest))) {
    phrases.push(m[1].trim().toLowerCase());
    stripped = stripped.replace(m[0], ' ');
  }

  for (const raw of stripped.split(/\s+/).filter(Boolean)) {
    const token = raw.toLowerCase();
    if (token.startsWith('tag:')) tags.push(slugify(token.slice(4)));
    else if (token.startsWith('in:')) fields.push(token.slice(3));
    else if (token.startsWith('-') && token.length > 1) excludes.push(token.slice(1));
    else terms.push(token);
  }
  return { terms, tags, phrases, excludes, fields };
}

export function search(index, q = {}, limit = 50) {
  const query = typeof q === 'string' ? parseQuery(q) : q;
  const { terms, tags, phrases, excludes, fields } = query;
  const wanted = fields.length ? new Set(fields) : new Set(['title', 'tags', 'description', 'body']);
  const results = [];

  for (const doc of index.docs) {
    if (doc.post.draft) continue;
    const { post } = doc;

    if (tags.length && !tags.every((t) => post.tags.some((x) => slugify(x) === t))) continue;
    if (excludes.length) {
      const hay = (post.title + ' ' + post.tags.join(' ') + ' ' + post.plain).toLowerCase();
      if (excludes.some((x) => hay.includes(x))) continue;
    }

    // field-restricted runs look at each field separately (in:title etc.)
    const fieldTokens = fields.length
      ? {
          title: tokenize(post.title),
          tags: tokenize(post.tags.join(' ')),
          description: tokenize(post.description),
          body: tokenize(post.plain),
        }
      : null;
    const FIELD_WEIGHT = { title: 10, tags: 6, description: 3, body: 1 };

    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const tokens = tokenize(term);
      let hit = 0;
      for (const token of tokens) {
        if (fieldTokens) {
          for (const name of wanted) {
            if (fieldTokens[name] && fieldTokens[name].includes(token)) hit += FIELD_WEIGHT[name];
          }
        } else {
          const raw = doc.tf.get(token) || 0;
          if (raw) hit += raw * 1.15;
        }
      }
      if (hit === 0) { matchedAll = false; break; }
      score += hit;
    }
    if (!matchedAll) continue;

    for (const phrase of phrases) {
      const hay = (post.title + ' ' + post.plain).toLowerCase();
      if (!hay.includes(phrase)) { matchedAll = false; break; }
      score += 25;
    }
    if (!matchedAll) continue;

    if (score > 0 || tags.length) {
      // gentle recency + shorter-post bonus so fresh, focused writing surfaces
      const ageDays = (Date.now() - post.date.getTime()) / 86400000;
      score += Math.max(0, 6 - ageDays / 60);
      score += 4 / Math.log2(doc.length + 2);
      results.push({ post, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score || b.post.date - a.post.date)
    .slice(0, limit)
    .map(({ post, score }) => ({
      ...postSummary(post),
      score: Math.round(score * 100) / 100,
      snippet: makeSnippet(post, [...terms, ...phrases]),
    }));
}

function postSummary(post) {
  return {
    slug: post.slug,
    title: post.title,
    url: post.url,
    date: post.date,
    tags: post.tags,
    description: post.description,
    readingTime: post.readingTime,
    cover: post.cover,
    wordCount: post.wordCount,
  };
}

export function makeSnippet(post, terms = [], radius = 90) {
  const text = post.plain;
  if (!terms.length) return truncate(text, radius * 2);
  const lower = text.toLowerCase();
  let at = -1;
  let hit = '';
  for (const term of terms) {
    const i = lower.indexOf(String(term).toLowerCase());
    if (i !== -1 && (at === -1 || i < at)) { at = i; hit = String(term).toLowerCase(); }
  }
  if (at === -1) return truncate(text, radius * 2);
  const start = Math.max(0, at - radius);
  const raw = text.slice(start, start + radius * 2);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safe = esc(raw);
  const marked = hit
    ? safe.replace(new RegExp('(' + hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>')
    : safe;
  return (start > 0 ? '…' : '') + marked + (start + radius * 2 < text.length ? '…' : '');
}

export function highlight(text = '', terms = []) {
  let out = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  for (const term of terms.filter(Boolean)) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('(' + safe + ')', 'ig'), '<mark>$1</mark>');
  }
  return out;
}

export { stripHtml };
