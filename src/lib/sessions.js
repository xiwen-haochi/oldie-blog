import crypto from 'node:crypto';
import { Store } from './store.js';

const COOKIE = 'oldie_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12h, like a long afternoon online

/** Stateless HMAC cookie + tiny server-side session store (revocable). */
export class Sessions {
  constructor({ secret, name = 'sessions' } = {}) {
    this.secret = secret || crypto.randomBytes(32).toString('hex');
    this.store = new Store(name, {});
    this.cookieName = COOKIE;
  }

  #sign(value) {
    return crypto.createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  #pack(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + this.#sign(body);
  }

  #unpack(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const idx = token.lastIndexOf('.');
    const body = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    const expected = this.#sign(body);
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
    catch { return null; }
  }

  static parseCookies(header = '') {
    const out = {};
    for (const part of String(header).split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  issue(res, data = {}) {
    const payload = { ...data, iat: Date.now(), exp: Date.now() + MAX_AGE_MS };
    const token = this.#pack(payload);
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE_MS,
      secure: false, // set true behind TLS (SITE_SECURE=1)
    });
    return token;
  }

  read(req, res) {
    const cookies = Sessions.parseCookies(req.headers.cookie || '');
    const payload = this.#unpack(cookies[this.cookieName]);
    if (!payload) return null;
    if (payload.exp < Date.now()) return null;
    if (payload.sid) {
      const all = this.store.sync();
      const session = all[payload.sid];
      if (!session || session.revoked) return null;
    }
    if (res && res.locals) res.locals.session = payload;
    return payload;
  }

  revoke(res) {
    res.clearCookie(this.cookieName, { path: '/' });
  }
}

/** CSRF: per-session random token echoed in a hidden input + header check. */
export function csrfToken(req) {
  if (req.session && req.session.csrf) return req.session.csrf;
  return '';
}

export function ensureCsrf(req) {
  if (!req.session) return '';
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('base64url');
  return req.session.csrf;
}

export function checkCsrf(req, submitted) {
  const expected = (req.session && req.session.csrf) || '';
  if (!expected || !submitted) return false;
  const a = Buffer.from(String(submitted));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Very small in-memory rate limiter for public forms (guestbook, zine). */
export function createRateLimiter({ windowMs = 60_000, max = 5 } = {}) {
  const hits = new Map();
  return function limiter(key) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

export { COOKIE as SESSION_COOKIE };
