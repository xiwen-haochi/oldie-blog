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
import { makeTranslator, availableLocales, localeMeta, clientStrings } from '../lib/i18n.js';

const loginLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 10 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const ALLOWED_IMAGE = /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/;
const MAX_UPLOAD = 4 * 1024 * 1024;

export function adminRoutes(ctx) {
  const router = express.Router();
  const A = ctx.site.adminPath || '/admin';
  const U = (suffix = '') => A + suffix;

  // belt and braces: even with JS disabled, nothing behind this path is indexable
  router.use((req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  /* ------------------------------------------------------------ guards */
  const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) return next();
    const next_ = encodeURIComponent(req.originalUrl || U());
    return res.redirect(U('/login?next=' + next_));
  };

  const requireCsrf = (req, res, next) => {
    if (checkCsrf(req, (req.body && req.body._csrf) || req.get('x-csrf-token'))) return next();
    res.status(403);
    return res.render('aw/error', {
      req,
      title: 'Access denied',
      nav: adminNav(null, A),
      csrf: (req.session && req.session.csrf) || '',
      flash: null,
      message: 'Your session token expired or was missing. Reload the admin page and try again.',
    });
  };

  /** Admin chrome is localized exactly like the public site. */
  const tr = (req) => makeTranslator((req && req.locale) || ctx.site.locale || 'zh-CN');
  const chrome = (req) => {
    const locale = (req && req.locale) || ctx.site.locale || 'zh-CN';
    return {
      adminPath: A,
      A,
      U,
      t: makeTranslator(locale),
      locale,
      localeMeta: localeMeta(locale),
      langs: availableLocales(),
      clientStrings: clientStrings(locale),
      dateLocale: localeMeta(locale).dateLocale,
      langSwitchUrl: (code) => {
        const path = (req && req.path) || U();
        return path + '?lang=' + encodeURIComponent(code);
      },
    };
  };

  const render = (res, view, locals = {}) => {
    const i18n = chrome(locals.req || res.req);
    if (view === 'login') {
      return res.render('admin/login', {
        site: ctx.site,
        ctx,
        nav: adminNav(i18n.t, A),
        csrf: (locals.req && locals.req.session && locals.req.session.csrf) || '',
        next: U(),
        error: null,
        form: {},
        mustChange: !!(loadCredentials().mustChange),
        ...i18n,
        ...locals,
      });
    }
    return res.render('aw/' + view, {
      site: ctx.site,
      ctx,
      nav: adminNav(i18n.t, A),
      flash: res.locals.flash || null,
      csrf: (locals.req && locals.req.session && locals.req.session.csrf) || '',
      ...i18n,
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
  router.get(A + '/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect(U());
    const i18n = chrome(req);
    res.render('admin/login', {
      site: ctx.site,
      ctx,
      nav: adminNav(i18n.t, A),
      csrf: (req.session && req.session.csrf) || '',
      next: String(req.query.next || U()),
      error: null,
      form: {},
      mustChange: !!(loadCredentials().mustChange),
      ...i18n,
    });
  });

  router.post(A + '/login', async (req, res) => {
    const i18n = chrome(req);
    if (!checkCsrf(req, (req.body && req.body._csrf) || req.get('x-csrf-token'))) {
      return res.status(403).render('admin/login', {
        site: ctx.site, ctx, nav: adminNav(null, A),
        csrf: (req.session && req.session.csrf) || '',
        next: U(), form: {}, mustChange: false,
        error: 'Your session token expired. Reload this page and try again.',
        ...i18n,
      });
    }
    const ip = req.clientIp || 'unknown';
    if (!loginLimiter(ip)) {
      return res.status(429).render('admin/login', {
        site: ctx.site, ctx, nav: adminNav(null, A),
        csrf: (req.session && req.session.csrf) || '',
        next: U(), form: {}, mustChange: false,
        error: 'Too many attempts. Wait a few minutes, then try again.',
        ...i18n,
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
        site: ctx.site, ctx, nav: adminNav(null, A),
        csrf: (req.session && req.session.csrf) || '',
        next: String(req.body.next || U()), form: { username: user }, mustChange: false,
        error: 'Wrong username or password. This attempt was written down in the visitor log.',
        ...i18n,
      });
    }

    ctx.sessions.issue(res, { user, csrf: crypto.randomBytes(16).toString('base64url'), iat: Date.now() });
    res.cookie('oldie_admin', '1', { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12, path: '/' });
    const nextUrl = String(req.body.next || U());
    res.redirect(nextUrl.startsWith(A) ? nextUrl : U());
  });

  router.post(A + '/logout', requireAuth, requireCsrf, (req, res) => {
    ctx.sessions.revoke(res);
    res.clearCookie('oldie_admin', { path: '/' });
    res.redirect(U('/login'));
  });

  /* -------------------------------------------------------- dashboard */
  router.get(A, requireAuth, (req, res) => res.redirect(U('/dashboard')));

  router.get(A + '/dashboard', requireAuth, (req, res) => {
    const stats = ctx.stats.summary();
    const community = ctx.community.stats();
    const posts = ctx.index.allPosts();
    const queue = ctx.community.moderationQueue().slice(0, 6);
    const seo = seoHealth(ctx, req.locale);
    render(res, 'dashboard', {
      req,
      title: tr(req)('admin.dashboard'),
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
  router.get(A + '/posts', requireAuth, (req, res) => {
    const filter = String(req.query.filter || 'all');
    let posts = ctx.index.allPosts();
    if (filter === 'draft') posts = posts.filter((p) => p.draft);
    if (filter === 'published') posts = posts.filter((p) => !p.draft);
    if (filter === 'featured') posts = posts.filter((p) => p.featured);
    const q = String(req.query.q || '').toLowerCase();
    if (q) posts = posts.filter((p) => (p.title + ' ' + p.slug + ' ' + p.tags.join(' ')).toLowerCase().includes(q));
    render(res, 'posts', {
      req,
      title: tr(req)('admin.posts'),
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

  router.get(A + '/posts/new', requireAuth, (req, res) => {
    render(res, 'editor', {
      req,
      title: tr(req)('admin.new_post'),
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

  router.get(A + '/posts/:slug/edit', requireAuth, (req, res, next) => {
    const raw = rawOf({ kind: 'post', slug: req.params.slug });
    if (!raw) return next();
    raw.data.slug = raw.data.slug || raw.file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    render(res, 'editor', {
      req,
      title: (raw.data.title || req.params.slug) + ' · ' + tr(req)('admin.edit'),
      kind: 'post',
      doc: raw,
      isNew: false,
      originalSlug: req.params.slug,
      uploads: listUploads(),
    });
  });

  router.post(A + '/posts', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const slug = String(req.body.originalSlug || '');
      const fields = normaliseFields(req.body, {});
      const saved = await saveDoc({ kind: 'post', slug, fields, body: req.body.body || '' });
      ctx.refresh();
      const tSave = makeTranslator((req && req.locale) || ctx.site.locale);
    setFlash(res, 'ok', tSave(slug ? 'admin.post_updated' : 'admin.post_created', { file: saved.file }));
      res.redirect(U('/posts/' + fields.slug + '/edit?saved=1'));
    } catch (err) { next(err); }
  });

  router.post(A + '/posts/:slug/delete', requireAuth, requireCsrf, async (req, res) => {
    const ok = await deleteDoc({ kind: 'post', slug: req.params.slug });
    ctx.refresh();
    setFlash(res, ok ? 'ok' : 'warn', ok ? 'Deleted ' + req.params.slug + '.md — check git status if you want it back.' : 'Nothing to delete.');
    res.redirect(U('/posts'));
  });

  router.post(A + '/posts/:slug/duplicate', requireAuth, requireCsrf, async (req, res) => {
    const raw = rawOf({ kind: 'post', slug: req.params.slug });
    if (!raw) return res.redirect(U('/posts'));
    const fields = normaliseFields({}, raw.data);
    fields.title = raw.data.title + ' (copy)';
    fields.slug = slugify(fields.slug + '-copy');
    fields.date = new Date().toISOString().slice(0, 10);
    fields.draft = true;
    await saveDoc({ kind: 'post', slug: '', fields, body: raw.body });
    ctx.refresh();
    setFlash(res, 'ok', makeTranslator((req && req.locale) || ctx.site.locale)('admin.post_duplicated', { slug: fields.slug }));
    res.redirect(U('/posts/' + fields.slug + '/edit'));
  });

  /* ------------------------------------------------------------ pages */
  router.get(A + '/pages', requireAuth, (req, res) => {
    render(res, 'pages', { req, title: 'Pages', pages: ctx.index.pages });
  });

  router.get(A + '/pages/new', requireAuth, (req, res) => {
    render(res, 'editor', {
      req, title: tr(req)('admin.new_page'), kind: 'page', isNew: true,
      doc: { file: '', data: { title: '', slug: '', description: '' }, body: '' },
      uploads: listUploads(),
    });
  });

  router.get(A + '/pages/:slug/edit', requireAuth, (req, res, next) => {
    const raw = rawOf({ kind: 'page', slug: req.params.slug });
    if (!raw) return next();
    raw.data.slug = raw.data.slug || raw.file.replace(/\.md$/, '');
    render(res, 'editor', {
      req, title: (raw.data.title || req.params.slug) + ' · ' + tr(req)('admin.edit'), kind: 'page',
      doc: raw, isNew: false, originalSlug: req.params.slug, uploads: listUploads(),
    });
  });

  router.post(A + '/pages', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const slug = String(req.body.originalSlug || '');
      const fields = normaliseFields(req.body, {});
      const saved = await saveDoc({ kind: 'page', slug, fields, body: req.body.body || '' });
      ctx.refresh();
      const tSave = makeTranslator((req && req.locale) || ctx.site.locale);
    setFlash(res, 'ok', tSave(slug ? 'admin.post_updated' : 'admin.post_created', { file: saved.file }));
      res.redirect(U('/pages/' + fields.slug + '/edit?saved=1'));
    } catch (err) { next(err); }
  });

  router.post(A + '/pages/:slug/delete', requireAuth, requireCsrf, async (req, res) => {
    const ok = await deleteDoc({ kind: 'page', slug: req.params.slug });
    ctx.refresh();
    setFlash(res, ok ? 'ok' : 'warn', ok ? 'Deleted page ' + req.params.slug : 'Nothing to delete.');
    res.redirect(U('/pages'));
  });

  /* -------------------------------------------------------- preview API */
  router.post(A + '/preview', requireAuth, requireCsrf, (req, res) => {
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
  router.get(A + '/guestbook', requireAuth, (req, res) => {
    const status = String(req.query.status || 'all');
    let entries = ctx.community.entries({ target: 'guestbook', status: 'all' });
    if (status !== 'all') entries = entries.filter((e) => (e.status || 'approved') === status);
    render(res, 'guestbook', {
      req,
      title: tr(req)('admin.guestbook'),
      entries,
      status,
      stats: ctx.community.stats(),
      comments: ctx.community.entries({ target: 'post:', status: 'all' }).length,
    });
  });

  router.post(A + '/guestbook/:id/status', requireAuth, requireCsrf, async (req, res) => {
    const entry = await ctx.community.setStatus(req.params.id, String(req.body.status || 'approved'));
    const t = makeTranslator((req && req.locale) || ctx.site.locale);
    setFlash(res, 'ok', entry ? t('admin.approve_done', { id: entry.id, status: req.body.status }) : t('admin.nothing_to_delete'));
    res.redirect(U('/guestbook?status=' + encodeURIComponent(String(req.query.status || 'all'))));
  });

  router.post(A + '/guestbook/:id/delete', requireAuth, requireCsrf, async (req, res) => {
    const removed = await ctx.community.remove(req.params.id);
    setFlash(res, 'ok', removed ? makeTranslator((req && req.locale) || ctx.site.locale)('admin.entry_deleted', { id: removed.id }) : makeTranslator((req && req.locale) || ctx.site.locale)('admin.nothing_to_delete'));
    res.redirect(U('/guestbook'));
  });

  /* -------------------------------------------------------- settings */
  router.get(A + '/settings', requireAuth, (req, res) => {
    render(res, 'settings', { req, title: makeTranslator(req.locale || ctx.site.locale)('admin.settings'), settings: ctx.site, defaults: DEFAULTS });
  });

  router.post(A + '/settings', requireAuth, requireCsrf, async (req, res, next) => {
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
      setFlash(res, 'ok', makeTranslator((req && req.locale) || ctx.site.locale)('admin.settings_saved'));
      res.redirect(U('/settings'));
    } catch (err) { next(err); }
  });

  router.post(A + '/settings/reset', requireAuth, requireCsrf, async (req, res) => {
    await fsp.rm(path.join(DATA_DIR, 'settings.json'), { force: true });
    ctx.refresh({ config: true });
    setFlash(res, 'ok', makeTranslator((req && req.locale) || ctx.site.locale)('admin.settings_reset'));
    res.redirect(U('/settings'));
  });

  router.post(A + '/password', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const current = String(req.body.current || '');
      const next1 = String(req.body.next || '');
      const credentials = loadCredentials();
      const plain = ctx.site.admin && ctx.site.admin.password;
      const t = makeTranslator((req && req.locale) || ctx.site.locale);
      if (!plain && !verifyPassword(current, credentials.password)) {
        setFlash(res, 'err', t('admin.password_wrong'));
        return res.redirect(U('/settings'));
      }
      if (next1.length < 10) {
        setFlash(res, 'err', t('admin.password_short'));
        return res.redirect(U('/settings'));
      }
      if (next1 !== String(req.body.confirm || '')) {
        setFlash(res, 'err', t('admin.password_mismatch'));
        return res.redirect(U('/settings'));
      }
      saveCredentials({ ...credentials, username: credentials.username || 'admin', password: hashPassword(next1), mustChange: false, updatedAt: new Date().toISOString() });
      setFlash(res, 'ok', t('admin.password_ok'));
      res.redirect(U('/settings'));
    } catch (err) { next(err); }
  });

  /* ----------------------------------------------------------- media */
  router.get(A + '/media', requireAuth, (req, res) => {
    render(res, 'media', { req, title: makeTranslator(req.locale || ctx.site.locale)('admin.media'), files: listUploads() });
  });

  router.post(A + '/media', requireAuth, upload.single('file'), requireCsrf, async (req, res, next) => {
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
        setFlash(res, 'err', makeTranslator((req && req.locale) || ctx.site.locale)('admin.paste_data_url'));
        return res.redirect(U('/media'));
      }
      if (buffer.length > MAX_UPLOAD) {
        const t = makeTranslator((req && req.locale) || ctx.site.locale);
        setFlash(res, 'err', t('admin.too_big', { size: humanBytes(buffer.length), max: humanBytes(MAX_UPLOAD) }));
        return res.redirect(U('/media'));
      }
      if (!ALLOWED_IMAGE.test(type)) {
        setFlash(res, 'err', makeTranslator((req && req.locale) || ctx.site.locale)('admin.not_image', { type: type || '?' }));
        return res.redirect(U('/media'));
      }

      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      const safe = slugify(name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + type.split('/')[1].replace('svg+xml', 'svg');
      await fsp.writeFile(path.join(UPLOAD_DIR, safe), buffer);
      ctx.site.uploads = listUploads();
      setFlash(res, 'ok', makeTranslator((req && req.locale) || ctx.site.locale)('admin.uploaded', { name: safe }));
      res.redirect(U('/media'));
    } catch (err) { next(err); }
  });

  router.post(A + '/media/delete', requireAuth, requireCsrf, async (req, res) => {
    const name = path.basename(String(req.body.name || ''));
    await fsp.rm(path.join(UPLOAD_DIR, name), { force: true });
    setFlash(res, 'ok', makeTranslator((req && req.locale) || ctx.site.locale)('admin.deleted', { name }));
    res.redirect(U('/media'));
  });

  /* ----------------------------------------------------------- tools */
  router.get(A + '/tools', requireAuth, (req, res) => {
    render(res, 'tools', {
      req,
      title: makeTranslator(req.locale || ctx.site.locale)('admin.tools'),
      health: seoHealth(ctx, req.locale),
      files: listFiles('post'),
      pageFiles: listFiles('page'),
      subscribers: ctx.community.subscriberList(),
      exportData: buildExport(ctx),
      raw: String(req.query.file || '') ? rawOf({ kind: 'post', slug: req.query.file }) : null,
    });
  });

  router.get(A + '/export.json', requireAuth, (req, res) => {
    res.set('Content-Disposition', 'attachment; filename="oldie-export.json"').json(buildExport(ctx));
  });

  return router;
}

/* ------------------------------------------------------------- helpers */

function adminNav(t, A = '/admin') {
  const label = (key, fallback) => (t ? t(key) : fallback);
  return [
    { href: A + '/dashboard', label: label('admin.dashboard', '📊 Dashboard') },
    { href: A + '/posts', label: label('admin.posts', '📝 Posts') },
    { href: A + '/pages', label: label('admin.pages', '📄 Pages') },
    { href: A + '/guestbook', label: label('admin.guestbook', '📬 Guestbook') },
    { href: A + '/media', label: label('admin.media', '🖼 Media') },
    { href: A + '/settings', label: label('admin.settings', '⚙ Settings') },
    { href: A + '/tools', label: label('admin.tools', '🛠 Tools') },
    { href: '/', label: label('admin.view_site', '🌐 View site') },
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

/** The SEO checklist shown on the dashboard and the tools page. */
export function seoHealth(ctx, locale) {
  const posts = ctx.index.publishedPosts();
  const checks = [];
  const t = makeTranslator(locale || ctx.site.locale);
  const zh = (locale || ctx.site.locale || 'zh-CN').startsWith('zh');
  const add = (ok, labelKey, detail) => checks.push({ ok, label: t(labelKey), detail });

  add(!!ctx.site.title, 'seo.title', ctx.site.title || 'config/site.config.json → title');
  add(String(ctx.site.url).startsWith('https') || process.env.NODE_ENV !== 'production',
    'seo.canonical', ctx.site.url + (zh ? '（生产环境请改成 https:// 加你的真实域名）' : ' (use https:// and your real domain in production)'));
  add(!!ctx.site.description, 'seo.description', truncate(ctx.site.description, 80));

  const noDesc = posts.filter((p) => !p.description);
  const allGood = zh ? '都没问题' : 'all good';
  add(noDesc.length === 0, 'seo.post_description', noDesc.length ? (zh ? '缺 ' + noDesc.length + ' 篇：' : noDesc.length + ' missing: ') + noDesc.slice(0, 3).map((p) => p.slug).join(', ') : allGood);

  const noTags = posts.filter((p) => !p.tags.length);
  add(noTags.length === 0, 'seo.post_tags', noTags.length ? (zh ? noTags.length + ' 篇没打标签' : noTags.length + ' untagged') : allGood);

  const short = posts.filter((p) => p.wordCount < 100);
  add(short.length === 0, 'seo.length', short.length ? (zh ? short.length + ' 篇太短' : short.length + ' very short') : allGood);

  const noAlt = posts.filter((p) => p.cover && !p.coverAlt);
  add(noAlt.length === 0, 'seo.alt', noAlt.length ? (zh ? noAlt.length + ' 张缺 alt 文本' : noAlt.length + ' missing alt text') : allGood);

  const dupes = {};
  posts.forEach((p) => { dupes[p.slug] = (dupes[p.slug] || 0) + 1; });
  const dupList = Object.keys(dupes).filter((k) => dupes[k] > 1);
  add(dupList.length === 0, 'seo.dupes', dupList.length ? dupList.join(', ') : allGood);

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
