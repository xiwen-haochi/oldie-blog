#!/usr/bin/env node
/**
 * Wipe everything that belongs to *you* and leave a clean blog behind.
 * Use it before publishing the repo, or when you want a fresh start:
 *
 *   pnpm clean            # move content into content/.backup-<date>, reset data/
 *   pnpm clean --force    # delete instead of moving
 *
 * What it never touches: source code, config/site.config.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, POSTS_DIR, PAGES_DIR, DATA_DIR, UPLOAD_DIR } from '../src/lib/paths.js';

const force = process.argv.includes('--force');
const today = new Date().toISOString().slice(0, 10);
const backup = path.join(ROOT, 'content', '.backup-' + today);

const WELCOME = [
  '---',
  'title: "第一篇文章"',
  'date: ' + today,
  'description: "把这里换成你的第一篇。"',
  'tags: [随笔]',
  '---',
  '',
  '欢迎来到你自己的博客。',
  '',
  '- 打开 /admin 写文章',
  '- 文章就是 content/posts/*.md，用任何编辑器都能改',
  '- 密码忘了就运行 pnpm reset:admin',
  '',
].join('\n');

function wipe(dir, label) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((n) => /\.(md|json|txt)$/.test(n));
  if (!files.length) return 0;
  const target = force ? null : path.join(backup, label);
  if (target) fs.mkdirSync(target, { recursive: true });
  for (const name of files) {
    const from = path.join(dir, name);
    if (force) fs.rmSync(from, { force: true });
    else fs.renameSync(from, path.join(target, name));
  }
  return files.length;
}

let removed = 0;
removed += wipe(POSTS_DIR, 'posts');
removed += wipe(PAGES_DIR, 'pages');
removed += wipe(DATA_DIR, 'data');
removed += wipe(UPLOAD_DIR, 'uploads');

for (const dir of [POSTS_DIR, PAGES_DIR, DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

const first = path.join(POSTS_DIR, today + '-first-post.md');
if (!fs.existsSync(first)) fs.writeFileSync(first, WELCOME);

console.log('');
console.log('  清掉了 ' + removed + ' 个文件' + (force ? '（已删除）' : ' -> content/.backup-' + today));
console.log('  留了一篇示例文章：content/posts/' + path.basename(first));
console.log('');
console.log('  还要你手动处理的：');
console.log('   · config/site.config.json 里的站名 / 作者 / webring 名字 —— 那是你的身份信息');
console.log('   · config/admin.json 和 data/ 已在 .gitignore 里，不会进仓库');
console.log('');
