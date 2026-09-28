import crypto from 'node:crypto';
import { JsonStore } from './store.js';
import { DATA_DIR } from './paths.js';
import path from 'node:path';

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Classic hit counter with a modern spine: totals, per-day, per-path, unique
 * visitors (salted hash, prunable) and a live "online now" gauge.
 */
export class Stats {
  constructor({ file = path.join(DATA_DIR, 'stats.json'), seed = new Date().getFullYear() } = {}) {
    this.store = new JsonStore(file, { total: seed, firstSeen: new Date().toISOString(), days: {}, paths: {}, uniques: {} });
    this.online = new Map(); // visitorId -> last seen ms
    this.seed = seed;
  }

  get data() { return this.store.sync(); }

  visitorHash(ip, ua) {
    const salt = String(this.data.firstSeen || '');
    return crypto.createHash('sha256').update(salt + '|' + ip + '|' + ua).digest('hex').slice(0, 16);
  }

  /** Count one pageview. Skips bots, assets and admin. */
  async hit({ path: p = '/', ip = '', ua = '', visitorId = '', count = true } = {}) {
    const now = new Date();
    const key = dayKey(now);
    if (visitorId) this.online.set(visitorId, Date.now());
    this.pruneOnline();

    const base = {
      total: this.store.sync().total,
      today: this.store.sync().days[key] || 0,
      unique: this.data.uniques[key] ? Object.keys(this.data.uniques[key]).length : 0,
      sessionRank: this.store.sync().visits?.[visitorId] || 1,
      online: this.online.size,
    };
    if (!count) return base;

    const data = await this.store.update((d) => {
      d.total = (d.total || 0) + 1;
      d.days = d.days || {};
      d.days[key] = (d.days[key] || 0) + 1;
      d.paths = d.paths || {};
      d.paths[p] = (d.paths[p] || 0) + 1;
      d.uniques = d.uniques || {};
      d.uniques[key] = d.uniques[key] || {};
      if (visitorId) d.uniques[key][visitorId.slice(0, 12)] = (d.uniques[key][visitorId.slice(0, 12)] || 0) + 1;
      d.visits = d.visits || {};
      if (visitorId) d.visits[visitorId] = (d.visits[visitorId] || 0) + 1;
      return d;
    });

    // keep the day table from growing forever
    const keys = Object.keys(data.days).sort();
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete data.days[k];
    if (Object.keys(data.uniques).length > 400) {
      for (const k of Object.keys(data.uniques).sort().slice(0, 200)) delete data.uniques[k];
    }

    return {
      total: data.total,
      today: data.days[key] || 0,
      unique: Object.keys(data.uniques[key] || {}).length,
      sessionRank: data.visits?.[visitorId] || 1,
      online: this.online.size,
    };
  }

  pruneOnline() {
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    for (const [id, seen] of this.online) if (seen < cutoff) this.online.delete(id);
  }

  topPaths(limit = 10) {
    const paths = Object.entries(this.data.paths || {}).sort((a, b) => b[1] - a[1]);
    return paths.slice(0, limit).map(([path, count]) => ({ path, count }));
  }

  dailySeries(days = 30) {
    const out = [];
    const base = this.data.days || {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const k = dayKey(d);
      out.push({ date: k, count: base[k] || 0 });
    }
    return out;
  }

  summary() {
    const d = this.data;
    const days = Object.values(d.days || {});
    return {
      total: d.total || 0,
      today: d.days?.[dayKey()] || 0,
      unique: Object.keys(d.uniques?.[dayKey()] || {}).length,
      days: days.length,
      best: days.length ? Math.max(...days) : 0,
      paths: Object.keys(d.paths || {}).length,
      online: this.online.size,
      firstSeen: d.firstSeen,
    };
  }
}
