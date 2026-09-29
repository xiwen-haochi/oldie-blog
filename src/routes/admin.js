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
import { DEFAULTS, saveConfig, resetConfig } from '../lib/config.js';
import { listFiles as storageList, putFile, deleteFile, checkUpload, describeStorage, maxBytes } from '../lib/storage.js';
import { createBackup, restoreBackup, backupPreview } from '../lib/backup.js';
import { enrichLocals } from '../lib/present.js';
import { makeTranslator, availableLocales, localeMeta, clientStrings } from '../lib/i18n.js';

const loginLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 10 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
// a backup archive is not an image, and can be much larger than 4MB
const archiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.zip$/i.test(file.originalname || '') || /zip|x-zip|octet-stream/.test(file.mimetype || '');
    cb(ok ? null : Object.assign(new Error('not a zip'), { status: 400, code: 'NOT_A_ZIP' }), ok);
  },
});
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
    // Rendered through the shared helper on purpose: the admin chrome needs
    // site/t/nav/csrf, and a half-filled locals bag made this page itself
    // throw, turning a 403 into a 500.
    res.status(403);
    return render(res, 'error', {
      req,
      title: tr(req)('admin.access_denied'),
      message: tr(req)('admin.csrf_error'),
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
      isNew: false,
      originalSlug: '',
      // the editor's uploader must not carry its own idea of the size limit
      maxUploadBytes: maxBytes(ctx.site),
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

  /**
   * Multer refuses a file before the route handler ever runs, so its
   * complaints used to land on the generic error page. Send the operator back
   * to the form with the actual reason — on an upload screen, "something went
   * wrong" is useless.
   */
  const uploadRefused = (back, limitBytes) => (err, req, res, next) => {
    if (!err || (!err.code && !err.status)) return next(err);
    const t = tr(req);
    let text;
    if (err.code === 'NOT_A_ZIP') text = t('admin.restore_pick_zip');
    else if (err.code === 'LIMIT_FILE_SIZE') text = t('admin.upload_too_large', { max: humanBytes(limitBytes) });
    else text = t('admin.upload_failed', { msg: String(err.message || err.code).slice(0, 120) });
    setFlash(res, 'err', text);
    res.redirect(back);
  };

  /** Attachments come from whichever driver is configured (local disk or S3). */
  const listUploads = () => storageList(ctx.site);

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

  router.get(A + '/posts/new', requireAuth, async (req, res) => {
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
      uploads: await listUploads(),
    });
  });

  router.get(A + '/posts/:slug/edit', requireAuth, async (req, res, next) => {
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
      uploads: await listUploads(),
    });
  });

  router.post(A + '/posts', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const slug = String(req.body.originalSlug || '');
      // Patching, not replacing: a field the request never mentions has to keep
      // the value it already had. Saving an edit used to silently drop the
      // cover, because the stored front matter was thrown away first.
      const previous = slug ? rawOf({ kind: 'post', slug }) : null;
      const fields = normaliseFields(req.body, previous ? previous.data : {});
      if (fields.featured && !fields.featuredAt) fields.featuredAt = new Date().toISOString();
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

  router.get(A + '/pages/new', requireAuth, async (req, res) => {
    render(res, 'editor', {
      req, title: tr(req)('admin.new_page'), kind: 'page', isNew: true,
      doc: { file: '', data: { title: '', slug: '', description: '' }, body: '' },
      uploads: await listUploads(),
    });
  });

  router.get(A + '/pages/:slug/edit', requireAuth, async (req, res, next) => {
    const raw = rawOf({ kind: 'page', slug: req.params.slug });
    if (!raw) return next();
    raw.data.slug = raw.data.slug || raw.file.replace(/\.md$/, '');
    render(res, 'editor', {
      req, title: (raw.data.title || req.params.slug) + ' · ' + tr(req)('admin.edit'), kind: 'page',
      doc: raw, isNew: false, originalSlug: req.params.slug, uploads: await listUploads(),
    });
  });

  router.post(A + '/pages', requireAuth, requireCsrf, async (req, res, next) => {
    try {
      const slug = String(req.body.originalSlug || '');
      // same patching rule as posts: an omitted field keeps the value it had
      const previous = slug ? rawOf({ kind: 'page', slug }) : null;
      const fields = normaliseFields(req.body, previous ? previous.data : {});
      if (fields.featured && !fields.featuredAt) fields.featuredAt = new Date().toISOString();
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
      // A save that does not mention a field must not delete it. The browser
      // form sends everything, but a partial POST used to blank every checkbox
      // and every text field it happened to leave out — which turned the whole
      // site off in a single request.
      //
      // A checkbox needs the opposite reading of the same word. A browser sends
      // *nothing at all* for an unticked box, so "absent" meant "keep the
      // current value" here and no switch could ever be turned off — it ticked
      // itself straight back on. The form now carries a hidden value="off"
      // beside every box, so off is something you can actually say.
      const cur = ctx.site;
      // A ticked checkbox sitting next to its hidden "off" posts both values,
      // so the field arrives as ["off", "on"] and not as "on". Comparing
      // that pair to 'on' is false forever, which meant every switch in this
      // form could be turned off and never turned back on.
      const said = (k) => (b[k] === undefined ? undefined : (Array.isArray(b[k]) ? b[k][b[k].length - 1] : b[k]));
      const keep = (k, fallback) => { const v = said(k); return v === undefined ? fallback : v; };
      const flag = (k, current) => { const v = said(k); return v === undefined ? !!current : v === 'on'; };
      const text = (k, current, max) => String(keep(k, current === undefined || current === null ? '' : current)).slice(0, max);
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

      const features = cur.features || {};
      const s3 = (cur.storage && cur.storage.s3) || {};
      const storage = (cur.storage && cur.storage) || {};
      const theme = cur.theme || {};

      const settings = {
        title: text('title', cur.title, 120),
        tagline: text('tagline', cur.tagline, 200),
        description: text('description', cur.description, 400),
        author: text('author', cur.author, 120),
        email: text('email', cur.email, 120),
        since: text('since', cur.since, 20),
        url: text('url', cur.url, 300).replace(/\/+$/, ''),
        locale: text('locale', cur.locale || 'zh-CN', 16),
        postsPerPage: Math.min(50, Math.max(1, Number(keep('postsPerPage', cur.postsPerPage || 8)) || 8)),
        nav: b.nav === undefined ? (cur.nav || []) : parseNav(b.nav),
        webring: b.webring === undefined ? (cur.webring || []) : parseRing(b.webring),
        banners: b.banners === undefined ? (cur.banners || []) : parseBanners(b.banners),
        footer: text('footer', cur.footer, 300),
        icp: text('icp', cur.icp, 200),
        analytics: text('analytics', cur.analytics, 4000),
        features: {
          comments: flag('fComments', features.comments),
          moderateComments: flag('fModerateComments', features.moderateComments),
          guestbook: flag('fGuestbook', features.guestbook),
          moderateGuestbook: flag('fModerateGuestbook', features.moderateGuestbook),
          search: flag('fSearch', features.search),
          hitCounter: flag('fHitCounter', features.hitCounter),
          randomPost: flag('fRandomPost', features.randomPost),
          showToc: flag('fShowToc', features.showToc),
          showReadingTime: flag('fShowReadingTime', features.showReadingTime),
        },
        storage: {
          // a two-way switch that has to read as 's3' or 'local'
          driver: said('s3Enabled') === undefined ? (storage.driver || 'local') : (flag('s3Enabled', false) ? 's3' : 'local'),
          directory: text('directory', storage.directory || 'public/uploads', 200),
          maxSizeMb: Math.min(50, Math.max(1, Number(keep('maxSizeMb', storage.maxSizeMb || 4)) || 4)),
          publicPath: text('publicPath', storage.publicPath || '/uploads', 200),
          s3: {
            bucket: text('bucket', s3.bucket, 120),
            region: text('region', s3.region || 'auto', 40),
            endpoint: text('endpoint', s3.endpoint, 200),
            accessKeyId: text('accessKeyId', s3.accessKeyId, 120),
            // the field promises "leave empty to keep", so honour it: an
            // empty box must not wipe the stored secret
            secretAccessKey: String(b.secretAccessKey || '').trim()
              ? String(b.secretAccessKey).slice(0, 200)
              : String(s3.secretAccessKey || ''),
            prefix: text('prefix', s3.prefix === undefined ? 'blog' : s3.prefix, 120),
            publicUrl: text('publicUrl', s3.publicUrl, 300),
            pathStyle: flag('pathStyle', s3.pathStyle),
          },
        },
        theme: {
          accent: text('accent', theme.accent || '#008080', 20),
          accent2: text('accent2', theme.accent2 || '#000080', 20),
          showMarquee: flag('showMarquee', theme.showMarquee),
          showTerminal: flag('showTerminal', theme.showTerminal),
          showCounter: flag('showCounter', theme.showCounter),
        },
      };

      await fsp.mkdir(DATA_DIR, { recursive: true });
      saveConfig(settings);
      ctx.refresh({ config: true });
      setFlash(res, 'ok', makeTranslator((req && req.locale) || ctx.site.locale)('admin.settings_saved'));
      res.redirect(U('/settings'));
    } catch (err) { next(err); }
  });

  router.post(A + '/settings/reset', requireAuth, requireCsrf, async (req, res) => {
    resetConfig();
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
  router.get(A + '/media', requireAuth, async (req, res) => {
    render(res, 'media', {
      req,
      title: makeTranslator(req.locale || ctx.site.locale)('admin.media'),
      files: await listUploads(),
      storage: describeStorage(ctx.site),
      maxSize: maxBytes(ctx.site),
    });
  });

  router.post(A + '/media', requireAuth, upload.single('file'), uploadRefused(U('/media'), MAX_UPLOAD), requireCsrf, async (req, res, next) => {
    const t = makeTranslator((req && req.locale) || ctx.site.locale);
    try {
      const file = req.file;
      const inline = req.body && req.body.dataUrl;
      let buffer = null;
      let name = 'upload';
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
        name = req.body.filename || 'pasted-image';
      }

      if (!buffer) {
        setFlash(res, 'err', t('admin.paste_data_url'));
        return res.redirect(U('/media'));
      }

      // one place decides what is allowed, wherever it is going to be stored
      const problem = checkUpload(ctx.site, { size: buffer.length, type });
      if (problem) {
        setFlash(res, 'err', problem);
        return res.redirect(U('/media'));
      }

      const saved = await putFile(ctx.site, { buffer, filename: name, type });
      ctx.site.uploads = await listUploads();
      // the picker uploads with fetch and needs the url back; the plain browser
      // form keeps its redirect
      if (String(req.get('accept') || '').includes('application/json')) {
        return res.json({ ok: true, name: saved.name, url: saved.url, size: saved.size });
      }
      setFlash(res, 'ok', t('admin.uploaded', { name: saved.url }));
      res.redirect(U('/media'));
    } catch (err) {
      next(err);
    }
  });

  // the editor's image picker asks for the library as JSON, on demand, so
  // opening an editor never waits on the object store
  router.get(A + '/media.json', requireAuth, async (req, res) => {
    const files = await listUploads();
    res.set('Cache-Control', 'no-store');
    res.json({
      files: files.map((f) => ({ name: f.name, url: f.url, size: f.size, mtime: f.mtime })),
    });
  });

  router.post(A + '/media/delete', requireAuth, requireCsrf, async (req, res) => {
    const t = makeTranslator((req && req.locale) || ctx.site.locale);
    try {
      await deleteFile(ctx.site, String(req.body.name || req.body.key || ''));
      ctx.site.uploads = await listUploads();
      setFlash(res, 'ok', t('admin.deleted', { name: req.body.name || '' }));
    } catch (err) {
      setFlash(res, 'err', err.message);
    }
    res.redirect(U('/media'));
  });

  /* ------------------------------------------------------ backup/restore */
  router.get(A + '/backup', requireAuth, async (req, res) => {
    render(res, 'backup', {
      req,
      query: req.query,
      title: makeTranslator(req.locale || ctx.site.locale)('admin.backup'),
      preview: backupPreview(),
    });
  });

  router.get(A + '/backup/download', requireAuth, async (req, res, next) => {
    try {
      const { buffer, manifest } = createBackup();
      const stamp = manifest.createdAt.slice(0, 19).replace(/[-:T]/g, '');
      const name = (ctx.site.title || 'oldie-blog').replace(/[^\w\-\u4e00-\u9fff]+/g, '-') + '-backup-' + stamp + '.zip';
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name));
      res.set('Cache-Control', 'no-store');
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.post(A + '/backup/restore', requireAuth, archiveUpload.single('archive'), uploadRefused(U('/backup'), 512 * 1024 * 1024), requireCsrf, async (req, res) => {
    const t = makeTranslator((req && req.locale) || ctx.site.locale);
    try {
      const buffer = req.file ? req.file.buffer : null;
      if (!buffer) {
        setFlash(res, 'err', t('admin.restore_no_file'));
        return res.redirect(U('/backup'));
      }
      // restoring replaces your posts, messages and settings: make them type it
      if (String(req.body.confirm || '').trim() !== (ctx.site.title || '')) {
        setFlash(res, 'err', t('admin.restore_confirm_mismatch', { title: ctx.site.title }));
        return res.redirect(U('/backup'));
      }
      const result = await restoreBackup(buffer, { keepUploads: !!req.body.keepUploads });
      setFlash(res, 'ok', t('admin.restore_done', { files: result.files, date: result.createdAt }));
      res.redirect(U('/backup?restored=1'));
    } catch (err) {
      setFlash(res, 'err', t('admin.restore_failed', { msg: err.message }));
      res.redirect(U('/backup'));
    }
  });
  /* ----------------------------------------------------------- tools */
  router.get(A + '/tools', requireAuth, async (req, res) => {
    render(res, 'tools', {
      req,
      title: makeTranslator(req.locale || ctx.site.locale)('admin.tools'),
      health: seoHealth(ctx, req.locale),
      storage: describeStorage(ctx.site),
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

  // The admin renders its own errors. Without this the global handler would
  // render a public 500 page with no nav, and that page would then throw,
  // hiding the real message.
  router.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[admin error]', err);
    const i18n = chrome(req);
    res.status(status).render('aw/error', {
      site: ctx.site,
      ctx,
      req,
      nav: adminNav(i18n.t, A),
      isNew: false,
      originalSlug: '',
      flash: res.locals.flash || null,
      csrf: (req.session && req.session.csrf) || '',
      status,
      title: status + ' \u2014 ' + i18n.t('error.title'),
      message: err.expose ? err.message : i18n.t('error.detail'),
      detail: err.expose ? err.message : i18n.t('error.detail'),
      ...i18n,
    });
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
    { href: A + '/backup', label: label('admin.backup', '💾 Backup') },
    { href: '/', label: label('admin.view_site', '🌐 View site') },
  ];
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
