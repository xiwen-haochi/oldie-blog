import {
  formatDate, isoDate, truncate, slugify, pad, timeAgo, humanBytes, stripHtml, escapeHtml,
} from './text.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const monthName = (n) => MONTHS[Number(n) - 1] || '';

function webringIndexOf(site) {
  const list = site.webring || [];
  if (!list.length) return 0;
  // deterministic slot so every visitor sees themselves in the ring
  const bucket = new Date().getUTCDate() % list.length;
  return bucket + 1;
}

function webringHrefOf(site, delta) {
  const list = site.webring || [];
  if (!list.length) return '/';
  if (delta === 0) return list[Math.floor(Math.random() * list.length)].url;
  const i = (webringIndexOf(site) - 1 + delta + list.length * 2) % list.length;
  return list[i].url;
}

/**
 * Everything the shared chrome (header/sidebar/footer/layout) expects.
 * Injected once, then merged with per-route locals.
 */
/** Front matter dates arrive as Date objects; form inputs need YYYY-MM-DD. */
export function toDateInput(value) {
  if (!value) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}
export function baseLocals(ctx) {
  const site = ctx.site;
  return {
    truncate, formatDate, isoDate, slugify, pad, monthName, timeAgo, humanBytes, stripHtml, escapeHtml, toDateInput,
    webringHref: (d) => webringHrefOf(ctx.site, d),
    webringIndex: webringIndexOf(ctx.site),
    assetV: site.assetV || '1',
  };
}

export function enrichLocals(ctx, req, res, extra = {}) {
  const site = ctx.site;
  const posts = ctx.index.publishedPosts();
  const latest = posts[0] || null;
  const lastUpdated = latest
    ? formatDate(latest.updated || latest.date, { locale: site.locale, style: 'short' })
    : formatDate(new Date(), { locale: site.locale, style: 'short' });

  return {
    site,
    ctx,
    currentPath: req.path,
    year: new Date().getFullYear(),
    stats: ctx.stats.summary(),
    postCount: posts.length,
    totalWords: ctx.index.totalWords(),
    latestPost: latest,
    lastUpdated,
    guestbookCount: ctx.community.count({ target: 'guestbook' }),
    latestGuestbook: ctx.community.latest('guestbook'),
    subscriberCount: ctx.community.subscriberCount(),
    csrf: (req.session && req.session.csrf) || '',
    form: req.body || {},
    flash: res.locals.flash || null,
    ...extra,
  };
}
