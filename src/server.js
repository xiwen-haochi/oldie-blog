import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createContext } from './context.js';
import { VIEWS_DIR, PUBLIC_DIR, UPLOAD_DIR, DATA_DIR, ROOT } from './lib/paths.js';
import { baseLocals, enrichLocals } from './lib/present.js';
import { siteRoutes } from './routes/site.js';
import { metaRoutes } from './routes/meta.js';
import { apiRoutes } from './routes/api.js';
import { adminRoutes } from './routes/admin.js';
import { pageMeta, breadcrumbLd } from './lib/seo.js';
import { privacyReport, sensitiveOnDisk } from './lib/privacy.js';
import { getDataDriver } from './lib/store.js';
import { cookies, clientIp, visitorId, geoGuess, gzipMiddleware, countPageview } from './lib/http.js';
import { ensureCsrf } from './lib/sessions.js';
import { resolveLocale, makeTranslator, availableLocales, localeMeta, normaliseLocale, clientStrings } from './lib/i18n.js';
import { slugify } from './lib/text.js';

export function createApp(ctx = createContext()) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', VIEWS_DIR);
  app.set('x-powered-by', false);
  app.set('etag', 'strong');
  app.locals.ctx = ctx;
  app.disable('x-powered-by');

  // ---- global headers ----------------------------------------------------
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.set('Content-Security-Policy', [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
    ].join('; '));
    next();
  });

  app.use(gzipMiddleware);
  app.use(express.urlencoded({ extended: false, limit: '512kb' }));
  app.use(express.json({ limit: '512kb' }));
  app.use(cookies);
  app.use((req, res, next) => {
    req.clientIp = clientIp(req);
    next();
  });
  app.use(visitorId);
  app.use(geoGuess);
  app.use((req, res, next) => {
    const locale = resolveLocale(req, ctx.site.locale);
    req.locale = locale;
    res.locals.locale = locale;
    res.locals.t = makeTranslator(locale);
    res.locals.localeMeta = localeMeta(locale);
    res.locals.langs = availableLocales();
    res.locals.clientStrings = clientStrings(locale);
    // remember an explicit ?lang= choice for a year
    if (normaliseLocale(req.query && req.query.lang) && req.cookies.oldie_lang !== locale) {
      res.cookie('oldie_lang', locale, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: 'lax', path: '/' });
    }
    next();
  });
  app.use((req, res, next) => {
    // one-shot flash message carried in a cookie so redirects can show it
    if (req.cookies.oldie_flash) {
      try { res.locals.flash = JSON.parse(req.cookies.oldie_flash); } catch { /* bad cookie */ }
      res.clearCookie('oldie_flash', { path: '/' });
    }
    let session = ctx.sessions.read(req, res);
    const fresh = !session;
    if (!session) session = { iat: Date.now(), exp: Date.now() + 1000 * 60 * 60 * 12 };
    req.session = session;
    const hadCsrf = !!session.csrf;
    ensureCsrf(req);
    // anonymous visitors get a signed cookie too, so forms can carry CSRF
    if (fresh || !hadCsrf) ctx.sessions.issue(res, session);
    next();
  });

  // ---- static assets -----------------------------------------------------
  // CSS/JS are served with ?v=<hash>, so they are safe to cache hard even in
  // development — the browser stops re-downloading 58 KB on every navigation.
  const isProd = process.env.NODE_ENV === 'production';
  const staticOpts = {
    maxAge: isProd ? '30d' : '1h',
    etag: true,
    lastModified: true,
    immutable: isProd,
  };
  app.use(express.static(PUBLIC_DIR, staticOpts));
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', etag: true }));

  // HTML is cheap to revalidate and must never go stale: no-cache lets the
  // browser re-ask and get a cheap 304 thanks to the ETag express sets.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    next();
  });

  // ---- shared view locals ------------------------------------------------
  app.use((req, res, next) => {
    Object.assign(res.locals, baseLocals(ctx));
    next();
  });

  app.use(countPageview(ctx));

  // ---- routes ------------------------------------------------------------
  app.use('/api', apiRoutes(ctx));
  app.use(metaRoutes(ctx));
  app.use(adminRoutes(ctx));
  app.use(siteRoutes(ctx));

  // ---- markdown pages served at /<slug> ----------------------------------
  app.get('/:slug', (req, res, next) => {
    if (req.path.includes('.')) return next();
    const page = ctx.index.getPage(req.params.slug);
    if (!page) return next();
    const meta = pageMeta(ctx.site, {
      title: page.title,
      description: page.description,
      url: page.url,
      image: page.cover,
      noindex: page.noindex,
      canonical: page.canonical,
      tags: page.tags,
      publishedAt: page.date.toISOString(),
      updatedAt: (page.updated || page.date).toISOString(),
      jsonLd: [breadcrumbLd(ctx.site, [{ name: 'Home', href: '/' }, { name: page.title, href: page.url }])],
    });
    res.render('pages/page', enrichLocals(ctx, req, res, { page: meta, doc: page }));
  });

  // ---- 404 ---------------------------------------------------------------
  app.use((req, res) => {
    const t = makeTranslator(req.locale || ctx.site.locale);
    const page = pageMeta(ctx.site, {
      title: '404',
      description: t('404.detail'),
      url: req.originalUrl,
      noindex: true,
    });
    res.status(404).render('pages/error', enrichLocals(ctx, req, res, {
      page,
      status: 404,
      title: t('404.title'),
      detail: t('404.detail'),
    }));
  });

  // ---- error handler -----------------------------------------------------
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    if (req.path.startsWith('/api')) {
      return res.status(status).json({ error: err.message || 'server error' });
    }
    const t = makeTranslator(req.locale || ctx.site.locale);
    const page = pageMeta(ctx.site, {
      title: status + ' — ' + (err.message || 'error'),
      description: t('error.detail'),
      url: req.originalUrl,
      noindex: true,
    });
    res.status(status).render('pages/error', enrichLocals(ctx, req, res, {
      page,
      status,
      title: status + ': ' + (err.statusText || t('error.title')),
      detail: err.expose ? err.message : t('error.detail'),
    }));
  });

  return app;
}

export function startServer({ port = process.env.PORT || 4173, host = process.env.HOST || '127.0.0.1' } = {}) {
  const ctx = createContext();
  const app = createApp(ctx);
  const server = app.listen(port, host, () => {
    const addr = server.address();
    const shown = addr && typeof addr === 'object' ? addr.port : port;
    const base = 'http://' + host + ':' + shown;
    console.log('');
    console.log('  [1m[36m╔══════════════════════════════════════════════════╗[0m');
    console.log('  [1m[36m║  ' + ctx.site.title.padEnd(46) + '║[0m');
    console.log('  [1m[36m╚══════════════════════════════════════════════════╝[0m');
    console.log('  [32m▸[0m site    [4m' + base + '/[0m');
    console.log('  [32m▸[0m admin   [4m' + base + ctx.site.adminPath + '[0m');
    const warnings = privacyReport();
    for (const w of warnings) console.log('  ' + w);
    const secretFiles = sensitiveOnDisk();
    if (secretFiles.length) {
      console.log('  \u001b[90m▸\u001b[0m data    ' + getDataDriver() + ' 存储，' + secretFiles.length + ' 个文件在 data/ 里（已 gitignore，不会提交）');
    }
    console.log('  [32m▸[0m posts   ' + ctx.index.publishedPosts().length + ' published, ' + ctx.index.allPosts().filter((p) => p.draft).length + ' drafts');
    console.log('');
  });

  // a friendly message beats a stack trace when the port is taken
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error('  [31m✘ 端口 ' + port + ' 已经被占用了。[0m');
      console.error('');
      console.error('     换个端口：      PORT=4174 pnpm start');
      console.error('     或者停掉占用它的进程：');
      console.error('       lsof -nP -iTCP:' + port + ' -sTCP:LISTEN');
      console.error('');
    } else if (err.code === 'EACCES') {
      console.error('');
      console.error('  [31m✘ 没有权限监听 ' + port + ' 端口，1024 以下需要管理员权限。[0m');
      console.error('     换个高端口：      PORT=4174 pnpm start');
      console.error('');
    } else {
      console.error('  [31m✘ 无法启动服务器：' + err.message + '[0m');
    }
    process.exit(1);
  });

  return { app, server, ctx };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  startServer();
}
