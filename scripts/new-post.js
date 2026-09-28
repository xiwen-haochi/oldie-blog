#!/usr/bin/env node
/**
 * Create a post file from the terminal, the way a 1998 webmaster would:
 *   pnpm new:post "My post title" --tags=retro,web --draft
 */
import fs from 'node:fs';
import path from 'node:path';
import { POSTS_DIR } from '../src/lib/paths.js';
import { slugify } from '../src/lib/text.js';
import { frontMatter } from '../src/lib/writer.js';

const args = process.argv.slice(2);
const title = args.find((a) => !a.startsWith('--')) || 'Untitled';
const flag = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith('--' + name));
  return hit ? hit.split('=')[1] || fallback : fallback;
};
const draft = args.includes('--draft');

const date = new Date().toISOString().slice(0, 10);
const slug = slugify(flag('slug', title));
const file = path.join(POSTS_DIR, date + '-' + slug + '.md');

fs.mkdirSync(POSTS_DIR, { recursive: true });
if (fs.existsSync(file)) {
  console.error('already exists: ' + file);
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

fs.writeFileSync(
  file,
  frontMatter(
    {
      title,
      slug,
      date,
      description: '',
      tags: flag('tags', '').split(',').map((t) => t.trim()).filter(Boolean),
      draft,
      featured: false,
    },
    body,
  ),
);

console.log('created ' + path.relative(process.cwd(), file));
if (draft) console.log('it is a draft — flip draft:false in the front matter to publish');
