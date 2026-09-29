#!/usr/bin/env node
/**
 * Wipe everything that belongs to *you* and leave a clean blog behind.
 * Use it before publishing the repo, or when you want a fresh start:
 *
 *   pnpm clean            # dump the database and uploads to .backup-<date>/
 *   pnpm clean --force    # delete instead of keeping a copy
 *
 * What it never touches: source code, config/site.config.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, UPLOAD_DIR, DATA_DIR } from '../src/lib/paths.js';

const force = process.argv.includes('--force');
const today = new Date().toISOString().slice(0, 10);
const backupDir = path.join(ROOT, '.backup-' + today);

const { sqliteNames, sqliteDelete, sqliteDeleteWhere, databaseFile, sqliteClose } =
  await import('../src/lib/db.js');
const { saveDoc, normaliseFields } = await import('../src/lib/writer.js');
const { exportDatabase } = await import('../src/lib/migrate.js');

const WELCOME = [
  '欢迎来到你自己的博客。',
  '',
  '- 打开 /admin 写文章',
  '- 文章存在 data/oldie.sqlite 里，导出一份 .zip 就是全部内容',
  '- 密码忘了就运行 pnpm reset:admin',
  '',
].join('\n');

// 1. dump everything in the database ---------------------------------------
const dump = exportDatabase();
const keys = sqliteNames();
const articles = Object.values(dump.post || {}).length + Object.values(dump.page || {}).length;

if (!force) {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'oldie.json'), JSON.stringify(dump, null, 2) + '\n', 'utf8');
}

// 2. empty it --------------------------------------------------------------
for (const name of keys) sqliteDelete(name);

// 3. uploads ---------------------------------------------------------------
let uploads = 0;
if (fs.existsSync(UPLOAD_DIR)) {
  uploads = fs.readdirSync(UPLOAD_DIR).filter((n) => !n.startsWith('.')).length;
  if (!force) {
    const target = path.join(backupDir, 'uploads');
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      if (name.startsWith('.')) continue;
      fs.renameSync(path.join(UPLOAD_DIR, name), path.join(target, name));
    }
  } else {
    for (const name of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, name), { recursive: true, force: true });
  }
}
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// 4. leave one post behind, so the blog is not an empty room ---------------
await saveDoc({
  kind: 'post',
  slug: '',
  fields: normaliseFields({ title: '第一篇文章', slug: 'first-post', date: today, description: '把这里换成你的第一篇。', tags: '随笔' }),
  body: WELCOME,
});
sqliteClose();

console.log('');
console.log('  清掉了 ' + (articles + keys.filter((k) => !k.includes(':')).length) + ' 条数据库记录' +
  (force ? '（已删除）' : ' -> .backup-' + today + '/oldie.json'));
if (uploads) console.log('  清掉了 ' + uploads + ' 个上传文件' + (force ? '（已删除）' : ' -> .backup-' + today + '/uploads'));
console.log('  留了一篇示例文章：/posts/first-post');
console.log('');
console.log('  还要你手动处理的：');
console.log('   · config/site.config.json 里的站名 / 作者 / webring 名字 —— 那是你的身份信息');
console.log('   · 数据库在 ' + databaseFile() + '，已 gitignore');
console.log('');
