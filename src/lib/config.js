import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './paths.js';
import { sqliteGet, sqlitePut } from './db.js';

/**
 * Layered configuration, lowest priority first:
 *   1. DEFAULTS        - everything a fresh clone needs to boot
 *   2. site.config.json - a bootstrap seed, read only while the database has
 *                         never been written to; after that it is ignored
 *   3. the database     - where the admin writes, and the real settings
 *   4. environment      - PORT / SITE_URL / ADMIN_USER / ADMIN_PASSWORD / SESSION_SECRET
 */
export const SETTINGS_KEY = 'settings';

/**
 * The photo filters the site can apply, in the order the admin sees them.
 * An empty string means leave the pictures alone. The names are tokens, not
 * css: they end up in a data- attribute, and anything not on this list is
 * thrown away rather than pasted into a page.
 *
 * One for now. Six were tried and they all looked like a different site
 * rather than a different photograph, so the menu stays and the shelf does not.
 */
export const PHOTO_FILTERS = ['sepia'];
export const DEFAULTS = {
  title: 'My Home Page',
  tagline: 'Best viewed with Netscape Navigator 4.0 at 800x600',
  description: 'A hand-made corner of the World Wide Web.',
  author: 'Anonymous Webmaster',
  i18n: {},
  email: 'webmaster@example.com',
  // 'since' is the year the persona claims to have gone online;
  // default it to the real one so nobody has to edit a year by hand.
  since: String(new Date().getFullYear()),
  url: 'http://localhost:4173',
  locale: 'zh-CN',
  // where the admin lives. 'admin' and '/admin' and '/my-secret-door' all work.
  adminPath: '/admin',
  langDir: 'ltr',
  timezone: 'Asia/Shanghai',
  postsPerPage: 8,
  theme: {
    accent: '#008080',
    accent2: '#000080',
    bg: '#008080',
    font: 'verdana',
    showMarquee: true,
    showBlink: true,
    showTerminal: true,
    showMusic: true,
    showCounter: true,
    // no filter until someone asks for one: ageing every photograph on the
    // site is a taste call, and there is more than one way to do it
    photoFilter: '',
  },
  nav: [
    { label: 'HOME', href: '/' },
    { label: 'POSTS', href: '/posts' },
    { label: 'ARCHIVE', href: '/archive' },
    { label: 'TAGS', href: '/tags' },
    { label: 'GUESTBOOK', href: '/guestbook' },
    { label: 'ABOUT', href: '/about' },
  ],
  webring: [
    { title: 'The Really lame webring', url: 'https://example.com/ring/', note: 'ring master: uncle gronk' },
    { title: 'Dial-up survivors', url: 'https://example.com/modem/', note: '56k and proud' },
    { title: 'MIDI heaven', url: 'https://example.com/midi/', note: 'pls play quietly' },
  ],
  banners: [
    { text: 'NOW BROADCASTING: This page is best viewed at 800x600 in any browser made before 2004.', href: '#' },
    { text: 'SIGN MY GUESTBOOK!!! It takes 10 seconds and makes my day.', href: '/guestbook' },
  ],
  footer: 'Hand-coded in Notepad. No frameworks were harmed in the making of this page.',
  // feature switches — the questions every blog gets asked
  features: {
    comments: true,         // post comments
    moderateComments: true,  // comments wait for approval
    guestbook: true,        // the public guestbook
    moderateGuestbook: true,
    search: true,
    hitCounter: true,
    randomPost: true,
    showToc: true,          // table of contents on posts
    showReadingTime: true,
  },
  // where uploads live: 'local' (public/uploads) or 's3' (any S3-compatible store)
  storage: {
    driver: 'local',
    directory: 'public/uploads',
    maxSizeMb: 4,
    publicPath: '/uploads',
    s3: {
      bucket: '',
      region: 'auto',
      endpoint: '',        // https://s3.ap-east-1.amazonaws.com, or an R2 / MinIO endpoint
      accessKeyId: '',
      secretAccessKey: '',
      prefix: 'blog',
      publicUrl: '',       // CDN base; falls back to endpoint + bucket
      pathStyle: true,     // true for MinIO / R2, false for AWS
    },
  },
  analytics: '',
  icp: '',
  socials: [],
  passwordFree: false,
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/**
 * The site configuration as it stands right now.
 *
 * The settings file is a seed, not a source: once the database holds settings,
 * those are the answer and the file is ignored. A fresh clone boots from the
 * file, the first save copies it into the database, and from then on there is
 * exactly one place the configuration lives.
 */
export function loadConfig({ env = process.env } = {}) {
  const stored = sqliteGet(SETTINGS_KEY, null);
  const bootstrap = stored ? {} : readJson(path.join(CONFIG_DIR, 'site.config.json'));

  let config = deepMerge(deepMerge(DEFAULTS, bootstrap), stored || {});

  if (env.SITE_URL) config.url = env.SITE_URL.replace(/\/$/, '');
  if (env.SITE_TITLE) config.title = env.SITE_TITLE;
  if (env.ADMIN_USER) config.admin = { ...(config.admin || {}), username: env.ADMIN_USER };
  if (env.ADMIN_PASSWORD) config.admin = { ...(config.admin || {}), password: env.ADMIN_PASSWORD };

  config.admin = {
    username: 'admin',
    ...(config.admin || {}),
  };
  config.url = String(config.url).replace(/\/$/, '');
  config.locale = config.locale || 'zh-CN';
  config.adminPath = normaliseAdminPath(config.adminPath);
  return config;
}

/** Persist the settings document. The admin screen is the only writer. */
export function saveConfig(settings) {
  sqlitePut(SETTINGS_KEY, settings);
  return settings;
}

/** Forget the stored settings and fall back to the bootstrap file. */
export function resetConfig() {
  return sqlitePut(SETTINGS_KEY, {});
}

/** 'admin' → '/admin', '/my-secret-door/' → '/my-secret-door', junk → '/admin'. */
export function normaliseAdminPath(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '/admin';
  const parts = raw
    .split('/')
    .map((part) => part.replace(/[^\w\-\u4e00-\u9fff]/g, ''))
    .filter((part) => part && part !== '.' && part !== '..');
  const clean = '/' + parts.join('/');
  return clean.length > 1 ? clean : '/admin';
}

/** Absolute URL helper – never emits a double slash. */
export function absUrl(config, pathname = '/') {
  const base = config.url.replace(/\/$/, '');
  if (!pathname) return base + '/';
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return base + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

export { deepMerge };
