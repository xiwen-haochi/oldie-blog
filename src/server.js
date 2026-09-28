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
import { cookies, clientIp, visitorId, geoGuess, gzipMiddleware, countPageview } from './lib/http.js';
import { ensureCsrf } from './lib/sessions.js';
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
  const staticOpts = { maxAge: process.env.NODE_ENV === 'production' ? '30d' : 0, etag: true };
  app.use(express.static(PUBLIC_DIR, { ...staticOpts, extensions: [] }));
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

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
    const page = pageMeta(ctx.site, {
      title: '404 — page not found',
      description: 'That page does not exist. Here is the way home.',
      url: req.originalUrl,
      noindex: true,
    });
    res.status(404).render('pages/error', enrichLocals(ctx, req, res, {
      page,
      status: 404,
      title: '404: PAGE NOT FOUND',
      detail: 'The file you requested is not on this server. It may have been moved, renamed, or it never existed — like most of the links from 1999.',
    }));
  });

  // ---- error handler -----------------------------------------------------
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', err);
    if (req.path.startsWith('/api')) {
      return res.status(status).json({ error: err.message || 'server error' });
    }
    const page = pageMeta(ctx.site, {
      title: status + ' — ' + (err.message || 'error'),
      description: 'Something went wrong on this very small computer.',
      url: req.originalUrl,
      noindex: true,
    });
    res.status(status).render('pages/error', enrichLocals(ctx, req, res, {
      page,
      status,
      title: status + ': ' + (err.statusText || 'ERROR'),
      detail: err.expose ? err.message : 'An unexpected error occurred. The webmaster has been notified.',
    }));
  });

  return app;
}

export function startServer({ port = process.env.PORT || 4173, host = process.env.HOST || '127.0.0.1' } = {}) {
  const ctx = createContext();
  const app = createApp(ctx);
  const server = app.listen(port, host, () => {
    const addr = server.address();
    const shown = typeof addr === 'object' ? addr.port : port;
    console.log('');
    console.log('  \u001b[1m\u001b[36m╔══════════════════════════════════════════════════╗\u001b[0m');
    console.log('  \u001b[1m\u001b[36m║  ' + ctx.site.title.padEnd(46) + '║\u001b[0m');
    console.log('  \u001b[1m\u001b[36m╚══════════════════════════════════════════════════╝\u001b[0m');
    console.log('  \u001b[32m▸\u001b[0m site    \u001b[4mhttp://' + host + ':' + shown + '/\u001b[0m');
    console.log('  \u001b[32m▸\u001b[0m admin   \u001b[4mhttp://' + host + ':' + shown + '/admin\u001b[0m');
    console.log('  \u001b[32m▸\u001b[0m posts   ' + ctx.index.publishedPosts().length + ' published, ' + ctx.index.allPosts().filter((p) => p.draft).length + ' drafts');
    console.log('');
  });
  return { app, server, ctx };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  startServer();
}
