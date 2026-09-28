import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Sessions } from './sessions.js';

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg)/;
const MIN_BYTES = 900;

export function gzipMiddleware(req, res, next) {
  if (req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return next();

  const originalEnd = res.end.bind(res);
  const chunks = [];
  let ended = false;

  const collect = (chunk) => {
    if (chunk === undefined || chunk === null) return;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
  };
  const done = (enc, cb) => (typeof enc === 'function' ? enc : typeof cb === 'function' ? cb : undefined);

  res.setHeader('Vary', 'Accept-Encoding');

  res.write = function (chunk, enc, cb) {
    collect(chunk);
    const finish = done(enc, cb);
    if (finish) finish();
    return true;
  };

  res.end = function (chunk, enc, cb) {
    if (ended) return res;
    ended = true;
    collect(chunk);
    const body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    chunks.length = 0;
    const finish = done(enc, cb);

    const type = String(res.getHeader('Content-Type') || '');
    const wantsGzip = body.length > MIN_BYTES && COMPRESSIBLE.test(type) && !res.getHeader('Content-Encoding');
    if (wantsGzip) {
      res.setHeader('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      return originalEnd(zlib.gzipSync(body, { level: 6 }), finish);
    }
    if (body.length) return originalEnd(body, finish);
    return originalEnd(finish);
  };

  return next();
}

export function cookies(req, res, next) {
  req.cookies = Sessions.parseCookies(req.headers.cookie || '');
  next();
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

/** Stable per-browser id so "you are visitor #" and "your Nth visit" work. */
export function visitorId(req, res, next) {
  let id = req.cookies.oldie_vid;
  if (!id || !/^[a-f0-9]{16}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    res.cookie('oldie_vid', id, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: 'lax', path: '/' });
  }
  req.visitorId = id;
  next();
}

const GEO_HINTS = {
  CN: ['Shanghai', 'Beijing', 'Shenzhen', 'Hangzhou', 'Chengdu'],
  US: ['California', 'New York', 'Texas', 'Washington'],
  JP: ['Tokyo', 'Osaka'],
  DE: ['Berlin'],
  GB: ['London'],
  FR: ['Paris'],
  SG: ['Singapore'],
  TW: ['Taipei'],
  HK: ['Hong Kong'],
};

/** Best-effort, privacy-respecting "where are you dialing from" string. */
export function geoGuess(req, res, next) {
  const country = String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const city = String(req.headers['x-geo-city'] || req.headers['cf-ipcity'] || '').replace(/^"|"$/g, '');
  if (country && GEO_HINTS[country]) {
    const list = GEO_HINTS[country];
    req.geoGuess = city ? city + ', ' + country : list[Math.floor(Math.random() * list.length)] + ', ' + country;
  } else if (country) {
    req.geoGuess = country;
  } else {
    req.geoGuess = 'the World Wide Web';
  }
  next();
}

const BOT = /bot|crawler|spider|curl|wget|python-requests|headlesschrome|lighthouse|monitor|uptime|preview/i;

export function countPageview(ctx) {
  return function (req, res, next) {
    if (res.locals.counted) return next();
    if (ctx.site && ctx.site.features && !ctx.site.features.hitCounter) { res.locals.counted = true; return next(); }
    res.locals.counted = true;
    const ua = req.get('user-agent') || '';
    if (!ua || BOT.test(ua)) {
      req.bot = true;
      return next();
    }
    // counting touches the disk; never make the visitor wait for it
    ctx.stats.hit({ path: req.path, ip: req.clientIp, ua, visitorId: req.visitorId })
      .then((live) => { res.locals.liveStats = live; })
      .catch((err) => { console.error('[stats]', err.message); });
    next();
  };
}
