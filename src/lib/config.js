import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, DATA_DIR } from './paths.js';

/**
 * Layered configuration, lowest priority first:
 *   1. DEFAULTS      – everything a fresh clone needs to boot
 *   2. site.config.json – the file humans edit (committed to git)
 *   3. data/settings.json – overrides written from the admin UI (gitignored)
 *   4. environment   – PORT / SITE_URL / ADMIN_USER / ADMIN_PASSWORD / SESSION_SECRET
 */
export const DEFAULTS = {
  title: 'My Home Page',
  tagline: 'Best viewed with Netscape Navigator 4.0 at 800x600',
  description: 'A hand-made corner of the World Wide Web.',
  author: 'Anonymous Webmaster',
  email: 'webmaster@example.com',
  url: 'http://localhost:4173',
  locale: 'en',
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

export function loadConfig({ env = process.env } = {}) {
  const fileConfig = readJson(path.join(CONFIG_DIR, 'site.config.json'));
  const uiConfig = readJson(path.join(DATA_DIR, 'settings.json'));

  let config = deepMerge(deepMerge(DEFAULTS, fileConfig), uiConfig);

  if (env.SITE_URL) config.url = env.SITE_URL.replace(/\/$/, '');
  if (env.SITE_TITLE) config.title = env.SITE_TITLE;
  if (env.ADMIN_USER) config.admin = { ...(config.admin || {}), username: env.ADMIN_USER };
  if (env.ADMIN_PASSWORD) config.admin = { ...(config.admin || {}), password: env.ADMIN_PASSWORD };

  config.admin = {
    username: 'admin',
    ...(config.admin || {}),
  };
  config.url = String(config.url).replace(/\/$/, '');
  config.locale = config.locale || 'en';
  return config;
}

/** Absolute URL helper – never emits a double slash. */
export function absUrl(config, pathname = '/') {
  const base = config.url.replace(/\/$/, '');
  if (!pathname) return base + '/';
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return base + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

export { deepMerge };
