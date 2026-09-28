import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { checkCsrf, createRateLimiter } from '../lib/sessions.js';
import { verifyPassword, hashPassword, saveCredentials, loadCredentials } from '../lib/auth.js';
import { saveDoc, deleteDoc, rawOf, normaliseFields, listFiles } from '../lib/writer.js';
import { renderMarkdown, toPlainText, excerpt } from '../lib/markdown.js';
import { slugify, formatDate, humanBytes, readingTime, truncate } from '../lib/text.js';
import { UPLOAD_DIR, DATA_DIR, ROOT } from '../lib/paths.js';
import { DEFAULTS } from '../lib/config.js';

const loginLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 10 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const ALLOWED_IMAGE = /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/;
const MAX_UPLOAD = 4 * 1024 * 1024;

export function adminRoutes(ctx) {
  const router = express.Router();

  /* ------------------------------------------------------------ guards */
  const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) return next();
    const next_ = encodeURIComponent(req.originalUrl || '/admin');
    return res.redirect('/admin/login?next=' + next_);
  };

  const requireCsrf = (req, res, next) => {
    if (checkCsrf(req, (req.body && req.body._csrf) || req.get('x-csrf-token'))) return next();
    res.status(403);
    return res.render('aw/error', {
      req,
      title: 'Access denied',
      nav: adminNav(),
      csrf: (req.session && req.session.csrf) || '',
      flash: null,
      message: 'Your session token expired or was missing. Reload the admin page and try again.',
    });
  };

  const render = (res, view, locals = {}) => {
    if (view === 'login') {
      return res.render('admin/login', {
        site: ctx.site,
        ctx,
        nav: adminNav(),
        csrf: (locals.req && locals.req.session && locals.req.session.csrf) || '',
        next: '/admin',
        error: null,
        form: {},
        mustChange: !!(loadCredentials().mustChange),
        ...locals,
      });
    }
    return res.render('aw/' + view, {
      site: ctx.site,
      ctx,
      nav: adminNav(),
      flash: res.locals.flash || null,
      csrf: (locals.req && locals.req.session && locals.req.session.csrf) || '',
      ...locals,
    });
  };

  const setFlash = (res, type, text) => {
    res.locals.flash = { type, text };
    res.cookie('oldie_flash', JSON.stringify({ type: type, text: text }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 15000,
    });
  };

  /* ------------------------------------------------------------- login */
  router.get('/admin/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/admin');
    res.render('admin/login', {
      site: ctx.site,
      ctx,
      nav: adminNav(),
      csrf: (req.session && req.session.csrf) || '',
      next: String(req.query.next || '/admin'),
      error: null,
      form: {},
      mustChange: !!(loadCredentials().mustChange),
    });
  });

  router.post('/admin/login', async (req, res) => {
    if (!checkCsrf(req, (req.body && req.body._csrf) || req.get('x-csrf-token'))) {
      return res.status(403).render('admin/login', {
        site: ctx.site, ctx, nav: adminNav(),
        csrf: (req.session && req.session.csrf) || '',
        next: '/admin', form: {}, mustChange: false,
        error: 'Your session token expired. Reload this page and try again.',
      });
    }
    const ip = req.clientIp || 'unknown';
    if (!loginLimiter(ip)) {
      return res.status(429).render('admin/login', {
        site: ctx.site, ctx, nav: adminNav(),
        csrf: (req.session && req.session.csrf) || '',
        next: '/admin', form: {}, mustChange: false,
        error: 'Too many attempts. Wait a few minutes, then try again.',
      });
    }
    const credentials = loadCredentials();
    const user = String(req.body.username || '').trim();
    const pass = String(req.body.password || '');
    const plain = ctx.site.admin && ctx.site.admin.password;
    const okUser = user === (credentials.username || 'admin');
    const okPass = plain ? pass === plain : verifyPassword(pass, credentials.password);

    if (!okUser || !okPass) {
      return res.status(401).render('admin/login', {
        site: ctx.site, ctx, nav: adminNav(),
        csrf: (req.session && req.session.csrf) || '',
        next: String(req.body.next || '/admin'), form: { username: user }, mustChange: false,
        error: 'Wrong username or password. This attempt was written down in the visitor log.',
      });
    }

    ctx.sessions.issue(res, { user, csrf: crypto.randomBytes(16).toString('base64url'), iat: Date.now() });
    res.cookie('oldie_admin', '1', { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12, path: '/' });
    const nextUrl = String(req.body.next || '/admin');
    res.redirect(nextUrl.startsWith('/admin') ? nextUrl : '/admin');
  });

  router.post('/admin/logout', requireAuth, requireCsrf, (req, res) => {
    ctx.sessions.revoke(res);
    res.clearCookie('oldie_admin', { path: '/' });
    res.redirect('/admin/login');
  });

  /* -------------------------------------------------------- dashboard */
  router.get('/admin', requireAuth, (req, res) => res.redirect('/admin/dashboard'));

  router.get('/admin/dashboard', requireAuth, (req, res) => {
    const stats = ctx.stats.summary();
    const community = ctx.community.stats();
    const posts = ctx.index.allPosts();
    const queue = ctx.community.moderationQueue().slice(0, 6);
    const seo = seoHealth(ctx);
    render(res, 'dashboard', {
      req,
      title: 'Dashboard',
      stats,
      community,
      queue,
      seo,
      recent: posts.slice(0, 6),
      drafts: posts.filter((p) => p.draft),
      top: ctx.stats.topPaths(8),
      series: ctx.stats.dailySeries(30),
      uptime: Math.floor(process.uptime()),
      node: process.versions.node,
    });
  });

  /* ------------------------------------------------------------ posts */
  router.get('/admin/posts', requireAuth, (req, res) => {
    const filter = String(req.query.filter || 'all');
    let posts = ctx.index.allPosts();
    if (filter === 'draft') posts = posts.filter((p) => p.draft);
    if (filter === 'published') posts = posts.filter((p) => !p.draft);
    if (filter === 'featured') posts = posts.filter((p) => p.featured);
    const q = String(req.query.q || '').toLowerCase();
    if (q) posts = posts.filter((p) => (p.title + ' ' + p.slug + ' ' + p.tags.join(' ')).toLowerCase().includes(q));
    render(res, 'posts', {
      req,
      title: 'Posts',
      posts,
      filter,
      q,
      kind: 'post',
      counts: {
        all: ctx.index.allPosts().length,
        draft: posts.filter((p) => p.draft).length,
        published: posts.filter((p) => !p.draft).length,
        featured: ctx.index.allPosts().filter((p) => p.featured).length,
      },
    });
  });

  router.get('/admin/posts/new', requireAuth, (req, res) => {
    render(res, 'editor', {
      req,
      title: 'New post',
      kind: 'post',
      doc: {
        file: '',
        data: {
          title: '',
          slug: '',
          date: new Date().toISOString().slice(0, 10),
          description: '',
          tags: [],
          draft: false,
          featured: false,
          noindex: false,
        },
        body: '',
      },
      isNew: true,
      uploads: listUploads(),
    });
  });

  router.get('/admin/posts/:slug/edit', requireAuth, (req, res, next) => {
    const raw = rawOf({ kind: 'post', slug: req.params.slug });
    if (!raw) return next();
    raw.data.slug = raw.data.slug || raw.file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    render(res, 'editor', {
      req,
      title: 'Edit: ' + (raw.data.title || req.params.slug),
      kind: 'post',
      doc: raw,
      isNew: false,
      originalSlug: req.params.slug,
      uploads: listUploads(),
    });
  });

  router.post('/admin/posts', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const slug = String(req.body.originalSlug || '');
      const fields = normaliseFields(req.body, {});
      const saved = await saveDoc({ kind: 'post', slug, fields, body: req.body.body || '' });
      ctx.refresh();
      setFlash(res, 'ok', (slug ? 'Updated ' : 'Created ') + saved.file);
      res.redirect('/admin/posts/' + fields.slug + '/edit?saved=1');
    } catch (err) { next(err); }
  });

  router.post('/admin/posts/:slug/delete', requireAuth, requireCsrf, async (req, res) => {
    const ok = await deleteDoc({ kind: 'post', slug: req.params.slug });
    ctx.refresh();
    setFlash(res, ok ? 'ok' : 'warn', ok ? 'Deleted ' + req.params.slug + '.md — check git status if you want it back.' : 'Nothing to delete.');
    res.redirect('/admin/posts');
  });

  router.post('/admin/posts/:slug/duplicate', requireAuth, requireCsrf, async (req, res) => {
    const raw = rawOf({ kind: 'post', slug: req.params.slug });
    if (!raw) return res.redirect('/admin/posts');
    const fields = normaliseFields({}, raw.data);
    fields.title = raw.data.title + ' (copy)';
    fields.slug = slugify(fields.slug + '-copy');
    fields.date = new Date().toISOString().slice(0, 10);
    fields.draft = true;
    await saveDoc({ kind: 'post', slug: '', fields, body: raw.body });
    ctx.refresh();
    setFlash(res, 'ok', 'Duplicated as a draft: ' + fields.slug);
    res.redirect('/admin/posts/' + fields.slug + '/edit');
  });

  /* ------------------------------------------------------------ pages */
  router.get('/admin/pages', requireAuth, (req, res) => {
    render(res, 'pages', { req, title: 'Pages', pages: ctx.index.pages });
  });

  router.get('/admin/pages/new', requireAuth, (req, res) => {
    render(res, 'editor', {
      req, title: 'New page', kind: 'page', isNew: true,
      doc: { file: '', data: { title: '', slug: '', description: '' }, body: '' },
      uploads: listUploads(),
    });
  });

  router.get('/admin/pages/:slug/edit', requireAuth, (req, res, next) => {
    const raw = rawOf({ kind: 'page', slug: req.params.slug });
    if (!raw) return next();
    raw.data.slug = raw.data.slug || raw.file.replace(/\.md$/, '');
    render(res, 'editor', {
      req, title: 'Edit: ' + (raw.data.title || req.params.slug), kind: 'page',
      doc: raw, isNew: false, originalSlug: req.params.slug, uploads: listUploads(),
    });
  });

  router.post('/admin/pages', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const slug = String(req.body.originalSlug || '');
      const fields = normaliseFields(req.body, {});
      const saved = await saveDoc({ kind: 'page', slug, fields, body: req.body.body || '' });
      ctx.refresh();
      setFlash(res, 'ok', (slug ? 'Updated ' : 'Created ') + saved.file);
      res.redirect('/admin/pages/' + fields.slug + '/edit?saved=1');
    } catch (err) { next(err); }
  });

  router.post('/admin/pages/:slug/delete', requireAuth, requireCsrf, async (req, res) => {
    const ok = await deleteDoc({ kind: 'page', slug: req.params.slug });
    ctx.refresh();
    setFlash(res, ok ? 'ok' : 'warn', ok ? 'Deleted page ' + req.params.slug : 'Nothing to delete.');
    res.redirect('/admin/pages');
  });

  /* -------------------------------------------------------- preview API */
  router.post('/admin/preview', requireAuth, requireCsrf, (req, res) => {
    const input = req.body || {};
    const markdown = String(input.body || '');
    const fields = normaliseFields(input, {});
    const html = renderMarkdown(markdown, { siteOrigin: ctx.site.url });
    res.json({
      html,
      wordCount: markdown.split(/\s+/).filter(Boolean).length,
      readingTime: readingTime(toPlainText(markdown)),
      excerpt: excerpt(markdown, 160),
      meta: {
        title: fields.title,
        description: fields.description || excerpt(markdown, 160),
        url: ctx.site.url + (fields.slug ? '/posts/' + fields.slug : ''),
        chars: toPlainText(markdown).length,
      },
    });
  });

  /* ------------------------------------------------------- guestbook */
  router.get('/admin/guestbook', requireAuth, (req, res) => {
    const status = String(req.query.status || 'all');
    let entries = ctx.community.entries({ target: 'guestbook', status: 'all' });
    if (status !== 'all') entries = entries.filter((e) => (e.status || 'approved') === status);
    render(res, 'guestbook', {
      req,
      title: 'Guestbook',
      entries,
      status,
      stats: ctx.community.stats(),
      comments: ctx.community.entries({ target: 'post:', status: 'all' }).length,
    });
  });

  router.post('/admin/guestbook/:id/status', requireAuth, requireCsrf, async (req, res) => {
    const entry = await ctx.community.setStatus(req.params.id, String(req.body.status || 'approved'));
    setFlash(res, 'ok', entry ? 'Entry #' + entry.id + ' → ' + req.body.status : 'Entry not found.');
    res.redirect('/admin/guestbook?status=' + encodeURIComponent(String(req.query.status || 'all')));
  });

  router.post('/admin/guestbook/:id/delete', requireAuth, requireCsrf, async (req, res) => {
    const removed = await ctx.community.remove(req.params.id);
    setFlash(res, 'ok', removed ? 'Deleted entry #' + removed.id : 'Entry not found.');
    res.redirect('/admin/guestbook');
  });

  /* -------------------------------------------------------- settings */
  router.get('/admin/settings', requireAuth, (req, res) => {
    render(res, 'settings', { req, title: 'Settings', settings: ctx.site, defaults: DEFAULTS });
  });

  router.post('/admin/settings', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const b = req.body;
      const parseList = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const parseNav = (v) => String(v || '').split('\n').map((line) => {
        const [label, href] = line.split(/\s*[|>]\s*/);
        return label && href ? { label: label.trim().toUpperCase(), href: href.trim() } : null;
      }).filter(Boolean);
      const parseRing = (v) => String(v || '').split('\n').map((line) => {
        const m = line.match(/^(.+?)\s*[|>]\s*(https?:\/\/\S+)(\s*[#:]\s*(.*))?$/);
        return m ? { title: m[1].trim(), url: m[2].trim(), note: (m[4] || '').trim() } : null;
      }).filter(Boolean);
      const parseBanners = (v) => String(v || '').split('\n').map((line) => {
        const m = line.match(/^(.+?)\s*[|>]\s*(\S+)$/);
        return m ? { text: m[1].trim(), href: m[2].trim() } : { text: line.trim(), href: '#' };
      }).filter((x) => x.text);

      const settings = {
        title: String(b.title || ctx.site.title).slice(0, 120),
        tagline: String(b.tagline || '').slice(0, 200),
        description: String(b.description || '').slice(0, 400),
        author: String(b.author || '').slice(0, 120),
        email: String(b.email || '').slice(0, 120),
        since: String(b.since || '').slice(0, 20),
        url: String(b.url || ctx.site.url).replace(/\/+$/, ''),
        locale: String(b.locale || 'en').slice(0, 16),
        postsPerPage: Math.min(50, Math.max(1, Number(b.postsPerPage) || 8)),
        nav: parseNav(b.nav),
        webring: parseRing(b.webring),
        banners: parseBanners(b.banners),
        footer: String(b.footer || '').slice(0, 300),
        icp: String(b.icp || '').slice(0, 200),
        analytics: String(b.analytics || '').slice(0, 4000),
        theme: {
          accent: String(b.accent || '#008080'),
          accent2: String(b.accent2 || '#000080'),
          showMarquee: !!b.showMarquee,
          showTerminal: !!b.showTerminal,
          showCounter: !!b.showCounter,
        },
      };

      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.writeFile(path.join(DATA_DIR, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', 'utf8');
      ctx.refresh({ config: true });
      setFlash(res, 'ok', 'Settings saved. data/settings.json now overrides config/site.config.json.');
      res.redirect('/admin/settings');
    } catch (err) { next(err); }
  });

  router.post('/admin/settings/reset', requireAuth, requireCsrf, async (req, res) => {
    await fsp.rm(path.join(DATA_DIR, 'settings.json'), { force: true });
    ctx.refresh({ config: true });
    setFlash(res, 'ok', 'Overrides removed — back to config/site.config.json.');
    res.redirect('/admin/settings');
  });

  router.post('/admin/password', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const current = String(req.body.current || '');
      const next1 = String(req.body.next || '');
      const credentials = loadCredentials();
      const plain = ctx.site.admin && ctx.site.admin.password;
      if (!plain && !verifyPassword(current, credentials.password)) {
        setFlash(res, 'err', 'Current password is wrong.');
        return res.redirect('/admin/settings');
      }
      if (next1.length < 10) {
        setFlash(res, 'err', 'New password must be at least 10 characters.');
        return res.redirect('/admin/settings');
      }
      if (next1 !== String(req.body.confirm || '')) {
        setFlash(res, 'err', 'The two new passwords do not match.');
        return res.redirect('/admin/settings');
      }
      saveCredentials({ ...credentials, username: credentials.username || 'admin', password: hashPassword(next1), mustChange: false, updatedAt: new Date().toISOString() });
      setFlash(res, 'ok', 'Password updated (scrypt, salted).');
      res.redirect('/admin/settings');
    } catch (err) { next(err); }
  });

  /* ----------------------------------------------------------- media */
  router.get('/admin/media', requireAuth, (req, res) => {
    render(res, 'media', { req, title: 'Media', files: listUploads() });
  });

  router.post('/admin/media', requireAuth, upload.single('file'), requireCsrf, async (req, res, next) => {
    try {
      const file = req.file;
      const inline = req.body && req.body.dataUrl;
      let buffer = null;
      let name = '';
      let type = '';

      if (file) {
        buffer = file.buffer;
        name = file.originalname || 'upload';
        type = file.mimetype || '';
      } else if (typeof inline === 'string' && inline.startsWith('data:')) {
        const m = /^data:([^;]+);base64,(.+)$/s.exec(inline);
        if (!m) throw Object.assign(new Error('That data URL looks wrong.'), { status: 400 });
        type = m[1];
        buffer = Buffer.from(m[2], 'base64');
        name = (req.body.filename || 'pasted-image') + '.' + (type.split('/')[1].replace('svg+xml', 'svg'));
      }

      if (!buffer) {
        setFlash(res, 'err', 'Pick a file or paste an image first.');
        return res.redirect('/admin/media');
      }
      if (buffer.length > MAX_UPLOAD) {
        setFlash(res, 'err', 'Too big: ' + humanBytes(buffer.length) + ' (limit ' + humanBytes(MAX_UPLOAD) + ').');
        return res.redirect('/admin/media');
      }
      if (!ALLOWED_IMAGE.test(type)) {
        setFlash(res, 'err', 'Only images please: ' + (type || 'unknown type'));
        return res.redirect('/admin/media');
      }

      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      const safe = slugify(name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + type.split('/')[1].replace('svg+xml', 'svg');
      await fsp.writeFile(path.join(UPLOAD_DIR, safe), buffer);
      ctx.site.uploads = listUploads();
      setFlash(res, 'ok', 'Uploaded /uploads/' + safe);
      res.redirect('/admin/media');
    } catch (err) { next(err); }
  });

  router.post('/admin/media/delete', requireAuth, requireCsrf, async (req, res) => {
    const name = path.basename(String(req.body.name || ''));
    await fsp.rm(path.join(UPLOAD_DIR, name), { force: true });
    setFlash(res, 'ok', 'Deleted ' + name);
    res.redirect('/admin/media');
  });

  /* ----------------------------------------------------------- tools */
  router.get('/admin/tools', requireAuth, (req, res) => {
    render(res, 'tools', {
      req,
      title: 'Tools',
      health: seoHealth(ctx),
      files: listFiles('post'),
      pageFiles: listFiles('page'),
      subscribers: ctx.community.subscriberList(),
      exportData: buildExport(ctx),
      raw: String(req.query.file || '') ? rawOf({ kind: 'post', slug: req.query.file }) : null,
    });
  });

  router.get('/admin/export.json', requireAuth, (req, res) => {
    res.set('Content-Disposition', 'attachment; filename="oldie-export.json"').json(buildExport(ctx));
  });

  return router;
}

/* ------------------------------------------------------------- helpers */

function adminNav() {
  return [
    { href: '/admin/dashboard', label: '📊 Dashboard' },
    { href: '/admin/posts', label: '📝 Posts' },
    { href: '/admin/pages', label: '📄 Pages' },
    { href: '/admin/guestbook', label: '📬 Guestbook' },
    { href: '/admin/media', label: '🖼 Media' },
    { href: '/admin/settings', label: '⚙ Settings' },
    { href: '/admin/tools', label: '🛠 Tools' },
    { href: '/', label: '🌐 View site' },
  ];
}

function listUploads() {
  try {
    return fs.readdirSync(UPLOAD_DIR)
      .filter((n) => !n.startsWith('.'))
      .map((n) => {
        const st = fs.statSync(path.join(UPLOAD_DIR, n));
        return { name: n, url: '/uploads/' + n, size: st.size, mtime: st.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/** The SEO checklist shown on the dashboard and tools page. */
export function seoHealth(ctx) {
  const posts = ctx.index.publishedPosts();
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok, label, detail });

  add(!!ctx.site.title, 'Site title set', ctx.site.title || 'config/site.config.json → title');
  add(String(ctx.site.url).startsWith('https') || process.env.NODE_ENV !== 'production',
    'Canonical URL is absolute', ctx.site.url + ' (use https:// and your real domain in production)');
  add(!!ctx.site.description, 'Meta description present', truncate(ctx.site.description, 80));

  const noDesc = posts.filter((p) => !p.description);
  add(noDesc.length === 0, 'Every post has a description', noDesc.length ? noDesc.length + ' missing: ' + noDesc.slice(0, 3).map((p) => p.slug).join(', ') : 'all good');

  const noTags = posts.filter((p) => !p.tags.length);
  add(noTags.length === 0, 'Every post is tagged', noTags.length ? noTags.length + ' untagged' : 'all good');

  const short = posts.filter((p) => p.wordCount < 100);
  add(short.length === 0, 'Posts are at least 100 words', short.length ? short.length + ' very short' : 'all good');

  const noAlt = posts.filter((p) => p.cover && !p.coverAlt);
  add(noAlt.length === 0, 'Cover images have alt text', noAlt.length ? noAlt.length + ' missing alt text' : 'all good');

  const dupes = {};
  posts.forEach((p) => { dupes[p.slug] = (dupes[p.slug] || 0) + 1; });
  const dupList = Object.keys(dupes).filter((k) => dupes[k] > 1);
  add(dupList.length === 0, 'No duplicate slugs', dupList.length ? dupList.join(', ') : 'all good');

  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { checks, score };
}

function buildExport(ctx) {
  return {
    generatedAt: new Date().toISOString(),
    site: {
      title: ctx.site.title,
      description: ctx.site.description,
      author: ctx.site.author,
      url: ctx.site.url,
      webring: ctx.site.webring,
      nav: ctx.site.nav,
    },
    posts: ctx.index.allPosts().map((p) => ({
      slug: p.slug, title: p.title, date: p.date, tags: p.tags, draft: p.draft,
      featured: p.featured, description: p.description, file: p.file, body: p.body,
    })),
    pages: ctx.index.pages.map((p) => ({ slug: p.slug, title: p.title, file: p.file, body: p.body })),
    guestbook: ctx.community.entries({ target: 'guestbook', status: 'all' }),
    subscribers: ctx.community.subscriberList(),
    stats: ctx.stats.summary(),
  };
}
