#!/usr/bin/env node
/**
 * Create a post from the terminal, the way a 1998 webmaster would:
 *   pnpm new:post "My post title" --tags=retro,web --draft
 *
 * It goes straight into the site database, like everything else.
 */
import { saveDoc, normaliseFields, fileNameFor, docExists } from '../src/lib/writer.js';

const args = process.argv.slice(2);
const title = args.find((a) => !a.startsWith('--')) || 'Untitled';
const flag = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith('--' + name));
  return hit ? hit.split('=')[1] || fallback : fallback;
};
const draft = args.includes('--draft');

const fields = normaliseFields({
  title,
  slug: flag('slug', '') || title,
  date: new Date().toISOString().slice(0, 10),
  tags: flag('tags', ''),
  draft: draft ? 'on' : '',
});

if (docExists({ kind: 'post', slug: fields.slug })) {
  console.error('already exists: ' + fileNameFor(fields));
  process.exit(1);
}

const body = [
  'Write your post here. Markdown plus raw HTML both work.',
  '',
  '<!-- more -->',
  '',
  '## A heading',
  '',
  'The text above this marker becomes the teaser on the home page.',
  '',
].join('\n');

const saved = await saveDoc({ kind: 'post', slug: '', fields, body });

console.log('created ' + saved.key);
console.log('edit it at /admin/posts/' + fields.slug + '/edit');
if (draft) console.log('it is a draft — uncheck 草稿 on the edit screen to publish');
