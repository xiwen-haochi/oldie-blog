import {
  formatDate, isoDate, truncate, slugify, pad, timeAgo, humanBytes, stripHtml, escapeHtml,
} from './text.js';
import { makeTranslator, availableLocales, localeMeta } from './i18n.js';
import { absUrl } from './config.js';

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
    truncate, formatDate, isoDate, slugify, pad, monthName, timeAgo, humanBytes, stripHtml, escapeHtml, toDateInput, absUrl,
    webringHref: (d) => webringHrefOf(ctx.site, d),
    webringIndex: webringIndexOf(ctx.site),
    assetV: site.assetV || '1',
  };
}

export function enrichLocals(ctx, req, res, extra = {}) {
  const locale = req.locale || ctx.site.locale || 'zh-CN';
  // config/site.config.json may carry per-locale overrides (i18n.zh-CN = {...})
  const localised = (ctx.site.i18n && ctx.site.i18n[locale]) || {};
  const site = Object.keys(localised).length
    ? { ...ctx.site, ...localised, theme: ctx.site.theme, i18n: ctx.site.i18n }
    : ctx.site;
  const t = makeTranslator(locale);
  const langs = availableLocales();
  const posts = ctx.index.publishedPosts();
  const latest = posts[0] || null;
  const lastUpdated = latest
    ? formatDate(latest.updated || latest.date, { locale: site.locale, style: 'short' })
    : formatDate(new Date(), { locale: site.locale, style: 'short' });

  // language switcher: same page, different locale, query param wins over cookie
  const langSwitchUrl = (code) => {
    const q = new URLSearchParams(req.query || {});
    q.set('lang', code);
    q.delete('page');
    return req.path + '?' + q.toString();
  };
  const alternates = langs.map((l) => ({
    code: l.code,
    href: langSwitchUrl(l.code),
    current: l.code === locale,
  }));

  return {
    site,
    ctx,
    t,
    locale,
    localeMeta: localeMeta(locale),
    langs,
    langSwitchUrl,
    alternates,
    dateLocale: localeMeta(locale).dateLocale,
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
