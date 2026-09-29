#!/usr/bin/env node
/**
 * End-to-end smoke test: boots the real server on a random port and drives
 * every public surface plus the whole admin flow over HTTP.
 *
 *   pnpm test:e2e
 *
 * It runs against a throwaway tree — its own content/, data/ and config/ — so
 * it passes on a fresh clone that has no posts yet, and it can never touch the
 * operator's own writing, counters or credentials.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

// --- build a sandbox before the app is imported: paths.js reads the env once --
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-e2e-'));
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
};

copyDir(path.join(PROJECT, 'config'), path.join(SANDBOX, 'config'));
// the view layer is resolved from ROOT/src, so the sandbox needs it too — as a
// symlink, because the templates are the code under test, not fixtures
try {
  fs.symlinkSync(path.join(PROJECT, 'src'), path.join(SANDBOX, 'src'), 'dir');
} catch {
  copyDir(path.join(PROJECT, 'src'), path.join(SANDBOX, 'src'));
}
// Static assets are big and read-only, so each one is a symlink and stays fast.
// public/ itself must NOT be: uploads land in public/uploads, and a symlink
// there would write every test upload into the operator's real library.
fs.mkdirSync(path.join(SANDBOX, 'public', 'uploads'), { recursive: true });
for (const asset of ['assets', 'css', 'js', 'vendor', 'favicon.svg']) {
  const from = path.join(PROJECT, 'public', asset);
  if (!fs.existsSync(from)) continue;
  try {
    fs.symlinkSync(from, path.join(SANDBOX, 'public', asset));
  } catch {
    copyDir(from, path.join(SANDBOX, 'public', asset));
  }
}
// the bundled sample posts, so the suite is deterministic on a fresh clone
copyDir(path.join(PROJECT, 'scripts', 'sample-content', 'posts'), path.join(SANDBOX, 'content', 'posts'));
copyDir(path.join(PROJECT, 'scripts', 'sample-content', 'pages'), path.join(SANDBOX, 'content', 'pages'));
fs.mkdirSync(path.join(SANDBOX, 'data'), { recursive: true });

process.env.OLDIE_ROOT = SANDBOX;
process.env.OLDIE_DATA_DIR = path.join(SANDBOX, 'data');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'smoke-test-password';

// now the app can be imported: it will resolve everything inside the sandbox
const { startServer } = await import('../src/server.js');
const { CONFIG_DIR } = await import('../src/lib/paths.js');
// the suite asserts on stored documents, not on files: articles are in the db
const { readDoc, listDocs, fileNameFor } = await import('../src/lib/writer.js');

const ROOT = SANDBOX;
// unique per run: the suite can be run repeatedly against the same data dir
const RUN_TAG = Math.random().toString(36).slice(2, 8);
const results = [];
let failures = 0;

// The sandbox has its own config dir, so nothing here can ever touch the real
// admin.json or settings.json. The backup dance is kept as a belt-and-braces
// guard for anyone who points OLDIE_ROOT somewhere unexpected.
const CREDS = path.join(CONFIG_DIR, 'admin.json');
const DATA_DIR = path.join(ROOT, 'data');
const SETTINGS = path.join(DATA_DIR, 'settings.json');
const settingsBackup = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
const credsBackup = fs.existsSync(CREDS) ? fs.readFileSync(CREDS, 'utf8') : null;
function restoreCreds() {
  if (settingsBackup === null) { try { fs.rmSync(SETTINGS, { force: true }); } catch { /* ignore */ } }
  else { try { fs.writeFileSync(SETTINGS, settingsBackup, 'utf8'); } catch { /* ignore */ } }
  if (credsBackup === null) { try { fs.rmSync(CREDS, { force: true }); } catch { /* ignore */ } }
  else { try { fs.writeFileSync(CREDS, credsBackup, 'utf8'); } catch { /* ignore */ } }
}
function cleanSandbox() {
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    // the OS cleans the temp dir eventually
  }
}
 async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log('  \u001b[32m✔\u001b[0m ' + name + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
  } catch (err) {
    failures++;
    results.push({ ok: false, name, detail: err.message });
    console.log('  \u001b[31m✘\u001b[0m ' + name + '\n      \u001b[31m' + String(err.message).slice(0, 300).replace(/\n/g, ' | ') + '\u001b[0m');
  }
}

function section(title) {
  console.log('\n\u001b[1m' + title + '\u001b[0m');
}

function cookieJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.entries()].map((kv) => kv[0] + '=' + kv[1]).join('; ');
    },
    absorb(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const line of raw) {
        const pair = String(line).split(';')[0];
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === '') jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}

async function main() {
  console.log('\n\u001b[1moldie-blog smoke test\u001b[0m');
  const { server, ctx } = startServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const jar = cookieJar();

  const get = async (p, init = {}) => {
    const res = await fetch(base + p, {
      redirect: 'manual',
      ...init,
      headers: { cookie: jar.header(), ...(init.headers || {}) },
    });
    jar.absorb(res);
    return res;
  };
  const text = async (p) => (await get(p)).text();
  const post = async (p, form) => {
    const res = await fetch(base + p, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
      // A string body goes out verbatim, so a test can post the same key
      // twice. new URLSearchParams({k: ['a', 'b']}) would quietly collapse
      // that to the single value "a,b" -- which is not what a browser sends,
      // and is how this suite managed to pass for so long.
      body: typeof form === 'string' ? form : new URLSearchParams(form).toString(),
    });
    jar.absorb(res);
    return res;
  };
  // the exact bytes a ticked checkbox + its hidden "off" produce
  const wire = (pairs) => pairs.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const csrfFrom = (html) => {
    const a = html.match(/name="csrf-token" content="([^"]+)"/);
    const b = html.match(/name="_csrf" value="([^"]+)"/);
    return (a && a[1]) || (b && b[1]) || '';
  };
  // Browsers post enctype="multipart/form-data", which is a different body
  // parser from the urlencoded one the other admin forms use.
  const postMultipart = async (p, form) => {
    const res = await fetch(base + p, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: jar.header() },
      body: form,
    });
    jar.absorb(res);
    return res;
  };

  section('public pages');
  const pages = [
    ['/', '欢迎来到我的主页'],
    ['/posts', '全部文章'],
    ['/archive', '往期归档'],
    ['/tags', '标签云'],
    ['/guestbook', '留言簿'],
    ['/search?q=markdown', '站内搜索'],
    ['/about', '制作说明'],
  ];
  for (const entry of pages) {
    const p = entry[0];
    const needle = entry[1];
    await check('GET ' + p, async () => {
      const res = await get(p);
      assert.equal(res.status, 200, 'status was ' + res.status);
      const html = await res.text();
      assert.ok(html.toLowerCase().includes(needle.toLowerCase()), 'missing text: ' + needle);
      return html.length + ' bytes';
    });
  }

  section('language switching');
  await check('defaults to Chinese', async () => {
    const html = await text('/');
    assert.match(html, /<html lang="zh-CN"/, 'html lang must be zh-CN');
    assert.match(html, /欢迎来到我的主页！/);
    assert.match(html, /环形网/, 'sidebar not localised');
    assert.ok(!html.includes('You are visitor'), 'English chrome leaked');
    return 'zh-CN';
  });
  await check('?lang=en switches the whole chrome', async () => {
    const html = await text('/?lang=en');
    assert.match(html, /<html lang="en"/);
    assert.match(html, /Welcome to my home page/);
    assert.ok(!html.includes('欢迎来到我的主页'), 'Chinese chrome leaked');
    return 'en';
  });
  await check('language choice is remembered in a cookie', async () => {
    const html = await text('/?lang=en');
    assert.match(html, /Welcome to my home page/, 'cookie was not stored');
    const again = await text('/');
    assert.match(again, /Welcome to my home page/, 'cookie not honoured on the next request');
    // put the test session back to Chinese for the remaining checks
    await text('/?lang=zh-CN');
    return 'persisted';
  });
  await check('switcher + hreflang alternates are rendered', async () => {
    const html = await text('/');
    assert.match(html, /class="tb-lang"/);
    assert.match(html, /hreflang="zh-CN"/);
    assert.match(html, /hreflang="en"/);
    assert.match(html, /og:locale:alternate/);
    return 'hreflang ok';
  });
  await check('posts render in both languages', async () => {
    const zh = await text('/posts/用-markdown-写博客这件事');
    assert.match(zh, /用 Markdown 写博客这件事/);
    const en = await text('/posts/用-markdown-写博客这件事?lang=en');
    assert.match(en, /READ MORE|继续阅读/);
    await text('/?lang=zh-CN');
    return 'CJK slug ok';
  });

  section('trimmed chrome');
  await check('no fake window controls or app menu bar', async () => {
    const html = await text('/');
    assert.ok(!html.includes('class="menubar"'), 'fake app menu bar still present');
    const titlebar = html.slice(html.indexOf('class="titlebar"'), html.indexOf('class="titlebar"') + 900);
    assert.ok(!titlebar.includes('tb-btn'), 'a window button survived inside the titlebar');
    return 'clean';
  });

  await check('1998 Time Machine mode works and is shareable', async () => {
    const html = await text('/');
    assert.match(html, /data-theme="classic"/);
    assert.ok(html.includes('data-toggle-theme'), 'no toggle in the markup');
    // the switch itself happens in the browser (?theme=1998 is read by site.js)
    const js = await text('/js/site.js');
    assert.match(js, /theme=\(1998\|classic\)/, 'site.js should honour ?theme=');
    const css = await text('/css/site.css');
    assert.match(css, /\[data-theme="1998"\]/);
    assert.match(html, /class="tm-banner"/, 'the 1998 banner element should exist (hidden in classic mode)');
    return 'toggle + shareable';
  });

  await check('dates use the real current year, not a hardcoded one', async () => {
    const thisYear = String(new Date().getFullYear());
    const html = await text('/');
    assert.match(html, new RegExp('© (?:' + thisYear + '|' + '[0-9]{4}[–-]' + thisYear + ')'), 'footer copyright should show ' + thisYear);
    assert.ok(!html.includes('© 1998–'), 'footer still pins 1998');
    assert.match(html, new RegExp('(建站于|webmaster since) ([0-9]{4})'), 'sidebar should state the founding year');
    return thisYear;
  });

  await check('zine and awards widgets are gone', async () => {
    const html = await text('/');
    assert.ok(!html.includes('/subscribe'), 'subscribe form still present');
    assert.ok(!html.includes('class="awards"'), 'awards widget still present');
    const css = await text('/css/site.css');
    assert.ok(!css.includes('.awards'), 'awards styles still shipped');
    return 'trimmed';
  });

  await check('the admin path is never advertised publicly', async () => {
    const health = await (await get('/healthz')).json();
    assert.equal(health.adminPath, '/admin', 'health endpoint should report the admin base');
    assert.equal(health.locale, 'zh-CN');
    const html = await text('/');
    assert.ok(!html.includes('/admin'), 'the admin path leaks into the public markup');
    const robots = await text('/robots.txt');
    assert.ok(!robots.includes('my-secret-door'), 'a custom admin path leaked into robots.txt');
    const feed = await text('/sitemap.xml');
    assert.ok(!feed.includes('/admin'), 'admin leaked into the sitemap');
    return 'quiet';
  });

  await check('admin login is reachable and stays unindexable', async () => {
    const res = await get('/admin/login');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.ok(!html.includes('19980'), 'login page leaks site statistics');
    return 'guarded';
  });

  await check('the public and login assets are versioned', async () => {
    // The static handler caches these for 30 days in production. A page whose
    // markup updates but whose script does not looks exactly like a button
    // that does nothing — which is how the cover picker "failed" once.
    const escaped = (tag) => tag.replace(/[/.]/g, (c) => '\\' + c);
    const stamped = (html, tag) => {
      const m = html.match(new RegExp('(?:href|src)="' + escaped(tag) + '(\\?v=[^"]*)?"'));
      return Boolean(m && m[1]);
    };
    const site = await text('/');
    for (const tag of ['/css/site.css', '/js/site.js']) {
      assert.ok(stamped(site, tag), tag + ' is unversioned on the home page');
    }
    // before signing in: /admin/login redirects once a session exists
    const login = await text('/admin/login');
    for (const tag of ['/css/site.css', '/css/admin.css']) {
      assert.ok(stamped(login, tag), tag + ' is unversioned on the login page');
    }
    return 'public + login stamped';
  });

  await check('static assets are cacheable, html is revalidated', async () => {
    const css = await get('/css/site.css');
    assert.match(css.headers.get('cache-control') || '', /max-age=(3600|\d+d)/);
    const home = await get('/');
    assert.equal(home.headers.get('cache-control'), 'no-cache');
    assert.ok(home.headers.get('etag'), 'html needs an ETag for cheap 304s');
    return 'headers ok';
  });

  await check('gzipped responses actually finish', async () => {
    // a small file used to stall for exactly 6s on the pass-through path
    const small = await get('/css/vendor/hljs.css');
    assert.equal(small.status, 200);
    const started = Date.now();
    const big = await get('/', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(big.status, 200);
    assert.ok(Date.now() - started < 2000, 'home page took too long with gzip');
    return 'fast';
  });

  section('SEO surface');
  await check('home head: canonical, og, json-ld, feeds', async () => {
    const html = await text('/');
    assert.match(html, /<link rel="canonical"/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /application\/rss\+xml/);
    return 'meta ok';
  });
  await check('post head: BlogPosting + article meta + TOC', async () => {
    const html = await text('/posts/welcome-to-my-homepage');
    assert.match(html, /"@type":"BlogPosting"/);
    assert.match(html, /article:published_time/);
    assert.match(html, /<details class="toc"/);
    return 'structured data ok';
  });
  const feeds = [
    ['/feed.xml', /<rss version="2.0"/],
    ['/atom.xml', /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom"/],
    ['/feed.json', /jsonfeed.org/],
    ['/sitemap.xml', /<urlset/],
    ['/robots.txt', /Sitemap:/],
    ['/site.webmanifest', /"display"/],
    ['/llms.txt', /^# /m],
  ];
  for (const entry of feeds) {
    const p = entry[0];
    const type = entry[1];
    await check('GET ' + p, async () => {
      const res = await get(p);
      assert.equal(res.status, 200, 'status ' + res.status);
      const body = await res.text();
      assert.match(body, type);
      return body.length + ' bytes';
    });
  }

  section('signature features');
  await check('.TXT download per post', async () => {
    const res = await get('/posts/welcome-to-my-homepage.txt');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /attachment/);
    const body = await res.text();
    assert.ok(body.includes('TITLE :'), 'missing header block');
    assert.ok(!body.includes('<!--'), 'raw html comment leaked into the txt');
    return body.split('\n').length + ' lines';
  });
  await check('.JSON representation of a post', async () => {
    const res = await get('/posts/welcome-to-my-homepage.json');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.markdown && data.html && data.plainUrl, 'missing fields');
    return data.readingTime + ' min read';
  });
  await check('terminal API answers real commands', async () => {
    const csrf = csrfFrom(await text('/'));
    assert.ok(csrf, 'no csrf token on the page');
    const res = await post('/api/terminal', { cmd: 'stats', _csrf: csrf });
    assert.equal(res.status, 200);
    const data = await res.json();
    const joined = data.lines.map((l) => l.text).join('\n');
    assert.match(joined, /total hits/);
    return data.lines.length + ' lines';
  });
  await check('terminal API refuses a bad CSRF token', async () => {
    const res = await post('/api/terminal', { cmd: 'stats', _csrf: 'nope' });
    assert.equal(res.status, 403);
    return 'blocked';
  });

  await check('the terminal publishes nothing unpublished', async () => {
    const csrf = csrfFrom(await text('/'));
    const say = async (cmd) => {
      const res = await post('/api/terminal', { cmd, _csrf: csrf });
      return (await res.json()).lines.map((l) => l.text).join('\n');
    };
    const stats = await say('stats');
    assert.ok(!/draft/i.test(stats), 'the draft count is public');
    assert.ok(!/pending/i.test(stats), 'the moderation queue size is public');

    // the exact patch level is a free CVE-targeting hint
    const colo = await say('colophon');
    const exact = new RegExp('node ' + process.versions.node.replace(/[.]/g, '\\.'));
    assert.ok(!exact.test(colo), 'the exact node version is public: ' + process.versions.node);
    assert.match(colo, /node [0-9]+/, 'colophon should still name a node major');

    // and a draft must not be reachable through the terminal at all
    assert.match(await say('type hidden-draft'), /cannot find/);
    return 'no drafts, no queue size, no patch level';
  });

  await check('neofetch reports the theme the visitor is in', async () => {
    const csrf = csrfFrom(await text('/'));
    const run = async (theme) => {
      const res = await post('/api/terminal', { cmd: 'neofetch', _csrf: csrf, theme });
      return (await res.json()).lines.map((l) => l.text).join('\n');
    };
    assert.match(await run('1998'), /Theme: 1998/);
    assert.match(await run('classic'), /Theme: classic/);
    assert.match(await run(undefined), /Theme: classic/, 'an unknown theme must not be trusted');
    return 'echoes the real one';
  });

  await check('search API honours tag: operator', async () => {
    const res = await get('/api/search?q=' + encodeURIComponent('tag:markdown'));
    const data = await res.json();
    assert.ok(data.count >= 1, 'expected hits, got ' + data.count);
    return data.count + ' hits';
  });

  section('guestbook and comments');
  await check('a guestbook entry waits in the moderation queue', async () => {
    const csrf = csrfFrom(await text('/guestbook'));
    assert.ok(csrf, 'the guestbook form must carry a _csrf field');
    const res = await post('/guestbook', {
      _csrf: csrf,
      name: 'Smoke Tester',
      email: 'smoke@example.com',
      url: 'https://example.com',
      location: 'Test Lab',
      message: 'Automated smoke test was here. [' + RUN_TAG + ']',
    });
    assert.equal(res.status, 302, 'sign status ' + res.status);
    assert.ok(!(await text('/guestbook')).includes('[' + RUN_TAG + ']'), 'a pending entry must stay private');
    return 'queued';
  });
  await check('honeypot spam is dropped', async () => {
    const csrf = csrfFrom(await text('/guestbook'));
    await post('/guestbook', { _csrf: csrf, name: 'Bot', message: 'cheap backlinks here', website: 'http://spam.example' });
    assert.ok(!(await text('/guestbook')).includes('cheap backlinks'), 'honeypot submission leaked');
    return 'blocked';
  });
  await check('a comment waits in the moderation queue', async () => {
    const csrf = csrfFrom(await text('/posts/welcome-to-my-homepage'));
    const res = await post('/comments', { _csrf: csrf, post: 'welcome-to-my-homepage', name: 'Reader', message: 'Great page! [' + RUN_TAG + ']' });
    assert.equal(res.status, 302);
    assert.ok(!(await text('/posts/welcome-to-my-homepage')).includes('Great page! [' + RUN_TAG + ']'), 'a pending comment must stay private');
    return 'queued';
  });

  section('errors');
  await check('unknown URL renders the 404 page', async () => {
    const res = await get('/definitely-not-here');
    assert.equal(res.status, 404);
    assert.match(await res.text(), /页面不存在/);
    return 'rendered';
  });
  await check('missing post 404s', async () => {
    const res = await get('/posts/no-such-post');
    assert.equal(res.status, 404);
    return 'handled';
  });

  section('admin');
  await check('admin guards anonymous visitors', async () => {
    const res = await get('/admin/dashboard');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') || '', /\/admin\/login/);
    return 'guarded';
  });

  await check('login with the wrong password fails', async () => {
    const csrf = csrfFrom(await text('/admin/login'));
    const res = await post('/admin/login', { _csrf: csrf, username: 'admin', password: 'definitely-wrong' });
    assert.equal(res.status, 401, 'status ' + res.status);
    return 'rejected';
  });

  let adminOk = false;
  await check('login with CSRF token', async () => {
    const csrf = csrfFrom(await text('/admin/login'));
    const res = await post('/admin/login', {
      _csrf: csrf,
      username: 'admin',
      password: process.env.ADMIN_PASSWORD,
      next: '/admin/dashboard',
    });
    assert.equal(res.status, 302, 'login status ' + res.status);
    const dash = await get('/admin/dashboard');
    assert.equal(dash.status, 200, 'dashboard status ' + dash.status);
    const body = await dash.text();
    assert.match(body, /控制台/);
    assert.match(body, /SEO 自检/);
    adminOk = true;
    return 'signed in';
  });


  if (adminOk) {
    let adminCsrf = '';
    await check('dashboard exposes a csrf token', async () => {
      adminCsrf = csrfFrom(await text('/admin/dashboard'));
      assert.ok(adminCsrf, 'no csrf token found');
      return 'ok';
    });

  await check('approving a pending entry publishes it', async () => {
    // the suite runs in a throwaway data dir, so the first pending entry is ours
    const page = await (await get('/admin/guestbook?status=pending')).text();
    const id = (page.match(/\/admin\/guestbook\/(\d+)\/status/) || [])[1];
    assert.ok(id, 'the pending entry should be listed in the admin');
    const res = await post('/admin/guestbook/' + id + '/status', { _csrf: adminCsrf, status: 'approved' });
    assert.equal(res.status, 302);
    assert.ok((await text('/guestbook')).includes('[' + RUN_TAG + ']'), 'the approved entry is still not public');
    return 'published';
  });

        const createdSlug = 'smoke-test-post';
    await check('create a post from the admin', async () => {
      const res = await post('/admin/posts', {
        _csrf: adminCsrf,
        title: 'Smoke Test Post',
        slug: createdSlug,
        date: '2025-06-01',
        description: 'Written by the smoke test to prove the writer works.',
        tags: 'smoke, testing',
        cover: '/uploads/smoke-cover.png',
        coverAlt: 'A cover, drawn',
        body: '# Hello from the admin\n\nWritten by the smoke test.\n\n- one\n- two',
      });
      assert.equal(res.status, 302, 'save status ' + res.status);
      // articles live in the database now; there is no file to find on disk
      const stored = readDoc({ kind: 'post', slug: createdSlug });
      assert.ok(stored, 'the post was not stored');
      assert.equal(stored.frontMatter.title, 'Smoke Test Post');
      assert.deepEqual(stored.frontMatter.tags, ['smoke', 'testing']);
      assert.match(stored.body, /Hello from the admin/);
      assert.equal((await get('/posts/' + createdSlug)).status, 200, 'post is not public');
      return fileNameFor(stored.frontMatter);
    });

    await check('drafts stay private', async () => {
      const res = await post('/admin/posts', {
        _csrf: adminCsrf,
        title: 'Hidden Draft',
        slug: 'hidden-draft',
        date: '2025-06-02',
        draft: 'on',
        body: 'Not ready yet.',
      });
      assert.equal(res.status, 302);
      assert.equal((await get('/posts/hidden-draft')).status, 404, 'draft leaked publicly');
      assert.ok((await text('/admin/posts?filter=draft')).includes('hidden-draft'), 'missing in admin');
      return 'hidden';
    });

    await check('markdown preview endpoint', async () => {
      const res = await post('/admin/preview', { _csrf: adminCsrf, body: '## Preview **works**', title: 'T' });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.match(data.html, /<h2 id="preview-works"/);
      assert.ok(data.readingTime >= 1);
      return 'rendered';
    });

    await check('update an existing post', async () => {
      const res = await post('/admin/posts', {
        _csrf: adminCsrf,
        originalSlug: createdSlug,
        title: 'Smoke Test Post',
        slug: createdSlug,
        date: '2025-06-01',
        description: 'Updated description.',
        tags: 'smoke',
        featured: 'on',
        body: 'Updated body.',
      });
      assert.equal(res.status, 302);
      assert.match(await text('/posts/' + createdSlug), /Updated description/);
      return 'updated';
    });

    await check('duplicate a post', async () => {
      const res = await post('/admin/posts/' + createdSlug + '/duplicate', { _csrf: adminCsrf });
      assert.equal(res.status, 302);
      assert.ok((await text('/admin/posts')).includes(createdSlug + '-copy'), 'copy not listed');
      return 'duplicated';
    });

    await check('moderate the guestbook', async () => {
      const page = await text('/admin/guestbook');
      const m = page.match(/\/admin\/guestbook\/(\d+)\/status/);
      assert.ok(m, 'no moderation controls rendered');
      const res = await post('/admin/guestbook/' + m[1] + '/status', { _csrf: adminCsrf, status: 'spam' });
      assert.equal(res.status, 302);
      assert.ok((await text('/admin/guestbook?status=spam')).includes('#' + m[1]), 'spam list is empty');
      return 'entry #' + m[1];
    });

    await check('a public guestbook entry never shows its address', async () => {
      const form = new URLSearchParams({
        _csrf: adminCsrf, name: 'Address Probe', message: 'leave my address alone',
        email: 'probe-secret@example.com', location: 'nowhere', url: '',
      });
      const res = await fetch(base + '/guestbook', {
        method: 'POST', redirect: 'manual',
        headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      jar.absorb(res);

      const publicPage = async () => (await get('/guestbook')).text();
      let page = await publicPage();
      // Whether it lands in the queue depends on the moderation switch, and the
      // suite flips that around. Only the published page is what matters here.
      if (!page.includes('leave my address alone')) {
        const pending = await (await get('/admin/guestbook?status=pending')).text();
        const at = pending.indexOf('Address Probe');
        assert.ok(at > 0, 'the probe entry is neither published nor queued');
        const m = pending.slice(at).match(/\/admin\/guestbook\/(\d+)\/status/);
        assert.ok(m, 'could not find the id to approve');
        assert.equal((await post('/admin/guestbook/' + m[1] + '/status', { _csrf: adminCsrf, status: 'approved' })).status, 302);
        page = await publicPage();
      }

      assert.ok(page.includes('leave my address alone'), 'the entry is not visible on the guestbook at all');
      assert.ok(!page.includes('probe-secret@example.com'), 'the address was published');
      assert.ok(!page.includes('mailto:probe-secret'), 'a mailto leaked');

      const list = await (await get('/admin/guestbook?status=all')).text();
      const m2 = list.match(/\/admin\/guestbook\/(\d+)\/status/);
      if (m2) await post('/admin/guestbook/' + m2[1] + '/delete', { _csrf: adminCsrf });
      return 'published, address still private';
    });

    await check('settings save applies live', async () => {
      const res = await post('/admin/settings', {
        _csrf: adminCsrf,
        title: 'Oldie Blog',
        tagline: 'Best viewed with Netscape Navigator 4.0 at 800x600',
        description: 'A hand-made 1990s personal homepage.',
        author: 'The Webmaster',
        email: 'webmaster@example.com',
        since: '1998',
        url: base,
        locale: 'en',
        postsPerPage: 5,
        nav: 'HOME | /\nPOSTS | /posts\nGUESTBOOK | /guestbook',
        webring: 'Test Ring | https://example.com/ring # ringmaster',
        banners: 'Smoke test banner | /',
        showMarquee: 'on',
        showTerminal: 'on',
        showCounter: 'on',
      });
      assert.equal(res.status, 302);
      assert.ok((await text('/')).includes('Smoke test banner'), 'banner not applied');
      return 'applied';
    });

    await check('the media library is readable as JSON for the editor picker', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const form = new FormData();
      form.set('_csrf', adminCsrf);
      form.set('file', new Blob([png], { type: 'image/png' }), 'picker-pixel.png');
      const up = await fetch(base + '/admin/media', {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: jar.header(), accept: 'application/json' },
        body: form,
      });
      jar.absorb(up);
      assert.equal(up.status, 200, 'a JSON upload must not redirect: ' + up.status);
      const saved = await up.json();
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.ok(saved.url, 'no url in the response: ' + JSON.stringify(saved));
      assert.ok(saved.name, 'no name in the response: ' + JSON.stringify(saved));

      const list = await get('/admin/media.json');
      assert.equal(list.status, 200);
      const json = await list.json();
      const found = json.files.find((f) => f.name === saved.name);
      assert.ok(found, 'the uploaded file is missing from media.json');
      assert.equal(found.url, saved.url, 'the picker and the upload must agree on the url');
      assert.equal(typeof found.size, 'number');
      return json.files.length + ' files, url ' + found.url;
    });

    await check('admin.js is versioned on the admin pages', async () => {
      const escaped = (tag) => tag.replace(/[/.]/g, (c) => '\\' + c);
      const dash = await text('/admin/dashboard');
      for (const tag of ['/css/site.css', '/css/admin.css', '/js/admin.js']) {
        const m = dash.match(new RegExp('(?:href|src)="' + escaped(tag) + '(\\?v=[^"]*)?"'));
        assert.ok(m, tag + ' is not linked on the dashboard');
        assert.ok(m[1], tag + ' is unversioned on the dashboard');
      }
      return 'admin.js stamped';
    });

    await check('a cover is saved and actually drawn on the post', async () => {
      const stored = readDoc({ kind: 'post', slug: createdSlug });
      assert.ok(stored, 'the post is not in the database');
      assert.equal(stored.frontMatter.cover, '/uploads/smoke-cover.png', 'the cover never reached the front matter');
      assert.equal(stored.frontMatter.coverAlt, 'A cover, drawn', 'the alt text never reached the front matter');

      const page = await (await get('/posts/' + createdSlug)).text();
      assert.match(page, /<figure class="article-cover">/, 'the cover is not drawn anywhere');
      assert.match(page, /<img src="\/uploads\/smoke-cover\.png" alt="A cover, drawn">/, 'the image or its alt text is wrong');
      return 'drawn with alt text';
    });

    await check('a cover shows up on the post list', async () => {
      // a fresh, dated-today post: the old smoke post is the oldest thing in
      // the archive and would sit on the last page of the list
      const today = new Date().toISOString().slice(0, 10);
      await post('/admin/posts', {
        _csrf: adminCsrf, title: 'Covered Post', slug: 'covered-post', date: today,
        cover: '/uploads/smoke-cover.png', coverAlt: 'A cover, drawn', body: 'Look at the list.',
      });
      const list = await (await get('/posts')).text();
      assert.match(list, /<li class="has-cover">/, 'the card did not become a cover card');
      assert.match(list, /<a class="post-thumb" href="\/posts\/covered-post" tabindex="-1" aria-hidden="true">\s*<img src="\/uploads\/smoke-cover\.png" alt="" loading="lazy">/,
        'the thumbnail markup is wrong');
      // a linked thumbnail must not be announced twice next to the title link
      assert.ok(!/post-thumb[^>]*><\s*<img src="[^"]+" alt="\S/.test(list), 'the thumbnail needs an empty alt');
      return 'thumbnail on the card';
    });

    await check('a post with no cover gets no cover element', async () => {
      await post('/admin/posts', {
        _csrf: adminCsrf, title: 'No Cover Here', slug: 'no-cover-here',
        date: '2025-06-03', body: 'Plain.',
      });
      const page = await (await get('/posts/no-cover-here')).text();
      assert.ok(!page.includes('article-cover'), 'an empty cover box was rendered');
      return 'no empty box';
    });

    await check('a checkbox that is turned OFF stays off', async () => {
      // A browser omits an unchecked box from the POST entirely, so the form
      // carries a hidden value and the handler reads that one. Note the
      // semantics: a field that is *absent* now means "no change"; turning
      // something off means sending the explicit off.
      const checked = (html) => /name="pathStyle" value="on"[^>]*checked/.test(html);
      const form = await text('/admin/settings');
      assert.match(form, /type="hidden" name="pathStyle" value="off"/,
        'without a hidden fallback an unchecked box submits nothing at all');

      await post('/admin/settings', { _csrf: adminCsrf, pathStyle: 'on' });
      assert.equal(checked(await text('/admin/settings')), true, '"on" must mean on');

      await post('/admin/settings', { _csrf: adminCsrf, pathStyle: 'off' });
      assert.equal(checked(await text('/admin/settings')), false, '"off" must mean off');

      await post('/admin/settings', { _csrf: adminCsrf });
      assert.equal(checked(await text('/admin/settings')), false, 'an absent field must mean no change, not off');
      return 'on, off, untouched';
    });

    await check('every switch in the settings form can actually be turned off', async () => {
      // An unticked box submits nothing at all, so the form has to say "off"
      // out loud with a hidden field. pathStyle had one; the other twelve did
      // not, which is why switching anything off snapped straight back on.
      const form = await text('/admin/settings');
      const names = [...form.matchAll(/<input type="checkbox" name="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(names.length >= 13, 'expected the full set of switches, saw ' + names.length);
      const silent = names.filter((n) => !form.includes('type="hidden" name="' + n + '" value="off"'));
      assert.deepEqual(silent, [], 'these cannot be switched off: ' + silent.join(', '));
      return names.length + ' switches, every one reversible';
    });

    await check('the appearance switches actually change the page', async () => {
      const ticked = async (n) => new RegExp('name="' + n + '"[^>]*checked').test(await text('/admin/settings'));

      await post('/admin/settings', {
        _csrf: adminCsrf, showMarquee: 'on', showTerminal: 'on', showCounter: 'on',
        banners: 'hello | #',
      });
      let home = await (await get('/')).text();
      assert.ok(home.includes('class="dock"'), 'the dock should have been on');
      assert.ok(home.includes('id="hit-counter"'), 'the counter should have been on');
      assert.ok(home.includes('marquee-bar'), 'the marquee should have been on');

      await post('/admin/settings', { _csrf: adminCsrf, showTerminal: 'off', showCounter: 'off', showMarquee: 'off' });
      home = await (await get('/')).text();
      assert.ok(!home.includes('class="dock"'), 'the dock did not go away');
      assert.ok(!home.includes('id="hit-counter"'), 'the counter did not go away');
      assert.ok(!home.includes('marquee-bar'), 'the marquee did not go away');

      assert.equal(await ticked('showTerminal'), false, 'showTerminal snapped back on');
      assert.equal(await ticked('showCounter'), false, 'showCounter snapped back on');
      assert.equal(await ticked('showMarquee'), false, 'showMarquee snapped back on');

      // and back on again -- an earlier version of this suite only ever
      // checked the off direction, so a switch that could be turned off but
      // never turned back on would have gone unnoticed
      await post('/admin/settings', {
        _csrf: adminCsrf, showTerminal: 'on', showCounter: 'on', showMarquee: 'on', banners: '',
      });
      home = await (await get('/')).text();
      assert.ok(home.includes('class="dock"'), 'the dock did not come back');
      assert.ok(home.includes('id="hit-counter"'), 'the counter did not come back');
      assert.equal(await ticked('showTerminal'), true, 'showTerminal did not come back');
      return 'off and on again, all three';
    });
    await check('a switch survives what a browser really sends', async () => {
      // A ticked box sitting next to its hidden "off" posts BOTH values, so
      // the handler sees the pair ["off", "on"] and not the string "on".
      // Comparing that pair to 'on' is false forever: every switch could be
      // turned off but never turned back on. The suite above hid this by
      // posting scalars by hand, which is not what a browser does.
      const ticked = async (n) => new RegExp('name="' + n + '"[^>]*checked').test(await text('/admin/settings'));

      await post('/admin/settings', wire([['_csrf', adminCsrf], ['pathStyle', 'off'], ['pathStyle', 'on']]));
      assert.equal(await ticked('pathStyle'), true, 'a ticked box must stay ticked');
      await post('/admin/settings', wire([['_csrf', adminCsrf], ['s3Enabled', 'off'], ['s3Enabled', 'on']]));
      assert.equal(await ticked('s3Enabled'), true, 'object storage could not be switched on');

      await post('/admin/settings', wire([['_csrf', adminCsrf], ['pathStyle', 'off'], ['s3Enabled', 'off']]));
      assert.equal(await ticked('pathStyle'), false, 'an unticked box must stay unticked');
      assert.equal(await ticked('s3Enabled'), false, 'object storage could not be switched off');
      return 'on, off, and the shape a browser sends';
    });

    await check('a partial settings save does not switch anything off', async () => {
      // Sending only the title used to blank every feature flag and empty every
      // text field it did not mention — the whole site off in one request.
      const res = await post('/admin/settings', { _csrf: adminCsrf, title: 'Partial Save Probe' });
      assert.equal(res.status, 302, 'settings save failed');

      const page = await (await get('/admin/settings')).text();
      const on = (name) => new RegExp('name="' + name + '"[^>]*checked').test(page);
      for (const flag of ['fComments', 'fGuestbook', 'fSearch', 'fHitCounter', 'showMarquee', 'showCounter']) {
        assert.ok(on(flag), flag + ' was silently switched off by a partial save');
      }
      assert.match(page, /value="Partial Save Probe"/, 'the one field that was sent did not land');
      // the nav textarea is multi-line, so match the first entry that was there
      assert.match(page, /<textarea[^>]*name="nav"[^>]*>[\\s\\S]*HOME/i, 'the navigation was wiped');
      assert.match(page, /name="accent"[^>]*value="#008080"/, 'the theme colour was reset');
      return 'nothing else moved';
    });
    await check('settings reset restores the config file', async () => {
      const res = await post('/admin/settings/reset', { _csrf: adminCsrf });
      assert.equal(res.status, 302);
      assert.ok(!(await text('/')).includes('Smoke test banner'), 'override still active');
      return 'reset';
    });

    await check('password rotation', async () => {
      const res = await post('/admin/password', {
        _csrf: adminCsrf,
        current: process.env.ADMIN_PASSWORD,
        next: 'a-brand-new-long-password',
        confirm: 'a-brand-new-long-password',
      });
      assert.equal(res.status, 302);
      assert.ok((await text('/admin/settings')).includes('密码已更新'), 'no confirmation');
      return 'rotated (restored after the suite)';
    });

    await check('media upload and delete', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const form = new FormData();
      form.set('_csrf', adminCsrf);
      form.set('file', new Blob([png], { type: 'image/png' }), 'smoke-pixel.png');
      const res = await fetch(base + '/admin/media', { method: 'POST', redirect: 'manual', headers: { cookie: jar.header() }, body: form });
      jar.absorb(res);
      const preview = (await res.clone().text()).slice(0, 200).replace(/\n/g, ' ');
      assert.equal(res.status, 302, 'upload status ' + res.status + ' loc=' + res.headers.get('location') + ' body=' + preview);
      const m = (await text('/admin/media')).match(/name="name" value="([^"]+)"/);
      assert.ok(m, 'upload not listed');
      const file = path.join(ROOT, 'public', 'uploads', m[1]);
      assert.ok(fs.existsSync(file), 'file missing on disk');
      assert.equal((await post('/admin/media/delete', { _csrf: adminCsrf, name: m[1] })).status, 302);
      assert.ok(!fs.existsSync(file), 'file not deleted');
      return m[1];
    });

    await check('tools page and JSON export', async () => {
      assert.match(await text('/admin/tools'), /SEO 自检清单/);
      const res = await get('/admin/export.json');
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.posts) && data.posts.length >= 4, 'export missing posts');
      return data.posts.length + ' posts exported';
    });

    await check('cleanup: delete the posts the test created', async () => {
      for (const slug of ['hidden-draft', createdSlug + '-copy', createdSlug]) {
        assert.equal((await post('/admin/posts/' + slug + '/delete', { _csrf: adminCsrf })).status, 302);
      }
      const left = fs.readdirSync(path.join(ROOT, 'content', 'posts')).filter((n) => n.includes('smoke') || n.includes('hidden'));
      assert.equal(left.length, 0, 'leftover files: ' + left.join(', '));
      return 'cleaned';
    });

    await check('backup archive downloads', async () => {
    const res = await get('/admin/backup/download');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /zip/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, 'the archive is empty');
    assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'not a zip file');
    return buf.length + ' bytes';
  });

  await check('the backup page asks before it overwrites', async () => {
    const page = await (await get('/admin/backup')).text();
    assert.match(page, /name="archive"/, 'no upload field');
    assert.match(page, /name="confirm"/, 'restore must ask for confirmation');
    return 'guarded';
  });

  await check('a restore with the wrong confirmation is refused', async () => {
    const res = await post('/admin/backup/restore', { _csrf: adminCsrf, confirm: 'definitely not the title' });
    assert.equal(res.status, 302);
    const page = await (await get('/admin/backup')).text();
    assert.ok(!page.includes('已恢复'), 'nothing should have been restored');
    return 'refused';
  });

  await check('a restore from the wrong kind of file explains itself', async () => {
    const form = new FormData();
    form.set('_csrf', adminCsrf);
    form.set('confirm', ctx.site.title);
    form.set('archive', new Blob([Buffer.from('not a zip at all')], { type: 'text/plain' }), 'notes.txt');
    const res = await postMultipart('/admin/backup/restore', form);
    assert.equal(res.status, 302, 'status ' + res.status);
    assert.match(res.headers.get('location') || '', /\/backup$/, 'should go back to the form');
    const page = await (await get('/admin/backup')).text();
    assert.match(page, /只能恢复 \.zip 备份包/, 'the operator is not told what was wrong');
    return 'redirected with a reason';
  });

  await check('a restore posted the way a browser posts it works', async () => {
    // the real form is enctype="multipart/form-data"; posting urlencoded
    // instead hides CSRF-from-body bugs that only multipart can trigger
    const archive = Buffer.from(await (await get('/admin/backup/download')).arrayBuffer());
    const form = new FormData();
    form.set('_csrf', adminCsrf);
    form.set('confirm', ctx.site.title);
    form.set('archive', new Blob([archive], { type: 'application/zip' }), 'backup.zip');
    const res = await postMultipart('/admin/backup/restore', form);
    const preview = (await res.clone().text()).slice(0, 300).replace(/\n/g, ' ');
    assert.equal(res.status, 302, 'status ' + res.status + ' loc=' + res.headers.get('location') + ' body=' + preview);
    assert.match(res.headers.get('location') || '', /restored=1/, 'restore did not report success');
    return 'restored ' + archive.length + ' bytes';
  });

  await check('a stale CSRF token is refused with 403, not a crash', async () => {
    const res = await post('/admin/settings', { _csrf: 'not-the-real-token', title: 'x' });
    assert.equal(res.status, 403, 'status ' + res.status);
    const page = await res.text();
    assert.match(page, /拒绝访问/, 'the admin should explain itself instead of showing an error page');
    return 'readable 403';
  });
  await check('logout ends the session', async () => {
      assert.equal((await post('/admin/logout', { _csrf: adminCsrf })).status, 302);
      assert.equal((await get('/admin/dashboard')).status, 302, 'still authenticated after logout');
      return 'signed out';
    });
  }

  server.close();
  restoreCreds();
  cleanSandbox();

  console.log('\n' + '─'.repeat(60));
  const passed = results.filter((r) => r.ok).length;
  console.log('\u001b[1m' + passed + '/' + results.length + ' checks passed\u001b[0m');
  if (failures) {
    console.log('\u001b[31m' + failures + ' failure(s)\u001b[0m');
    process.exit(1);
  }
  console.log('\u001b[32mall green\u001b[0m');
}

main().catch((err) => {
  restoreCreds();
  cleanSandbox();
  console.error('\u001b[31msmoke test crashed:\u001b[0m', err);
  process.exit(1);
});
