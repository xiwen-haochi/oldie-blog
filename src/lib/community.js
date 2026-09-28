import { JsonStore } from './store.js';
import { DATA_DIR } from './paths.js';
import path from 'node:path';

/**
 * Guestbook + post comments share one store. Each entry targets either the
 * guestbook (target = 'guestbook') or a post slug (target = 'post:<slug>').
 */
export class Community {
  constructor({ file = path.join(DATA_DIR, 'guestbook.json'), subscribersFile = path.join(DATA_DIR, 'subscribers.json') } = {}) {
    this.store = new JsonStore(file, { entries: [], nextId: 1, updatedAt: null });
    this.subscribers = new JsonStore(subscribersFile, { emails: [], addedAt: {} });
  }

  #all() { return this.store.sync().entries || []; }

  entries({ target = 'guestbook', status = 'approved', limit = 0 } = {}) {
    let list = this.#all().filter((e) => e.target === target);
    if (status !== 'all') list = list.filter((e) => (e.status || 'approved') === status);
    list = list.sort((a, b) => b.id - a.id);
    return limit ? list.slice(0, limit) : list;
  }

  count({ target = 'guestbook', status = 'approved' } = {}) {
    return this.entries({ target, status }).length;
  }

  latest(target = 'guestbook') {
    return this.entries({ target, limit: 1 })[0] || null;
  }

  async add({ target = 'guestbook', name, email = '', url = '', location = '', message, ip = '', ua = '', autoApprove = false }) {
    const entry = await this.store.update((d) => {
      d.entries = d.entries || [];
      d.nextId = (d.nextId || d.entries.length + 1);
      const record = {
        id: d.nextId++,
        target,
        name: String(name || 'Anonymous').slice(0, 40),
        email: String(email || '').slice(0, 80),
        url: normaliseUrl(url),
        host: hostOf(url),
        location: String(location || '').slice(0, 60),
        message: String(message || '').slice(0, 2000),
        date: new Date().toISOString(),
        status: autoApprove ? 'approved' : 'pending',
        ip: String(ip || '').slice(0, 45),
        ua: String(ua || '').slice(0, 120),
      };
      d.entries.push(record);
      d.updatedAt = record.date;
      return d;
    });
    return entry.entries[entry.entries.length - 1];
  }

  async setStatus(id, status) {
    let found = null;
    await this.store.update((d) => {
      for (const e of d.entries || []) {
        if (e.id === Number(id)) {
          e.status = status;
          e.moderatedAt = new Date().toISOString();
          found = e;
        }
      }
      return d;
    });
    return found;
  }

  async remove(id) {
    let removed = null;
    await this.store.update((d) => {
      d.entries = (d.entries || []).filter((e) => {
        const keep = e.id !== Number(id);
        if (!keep) removed = e;
        return keep;
      });
      d.updatedAt = new Date().toISOString();
      return d;
    });
    return removed;
  }

  moderationQueue() {
    return this.#all().filter((e) => (e.status || 'approved') === 'pending').sort((a, b) => b.id - a.id);
  }

  stats() {
    const all = this.#all();
    return {
      total: all.length,
      approved: all.filter((e) => (e.status || 'approved') === 'approved').length,
      pending: all.filter((e) => e.status === 'pending').length,
      spam: all.filter((e) => e.status === 'spam').length,
      comments: all.filter((e) => String(e.target || '').startsWith('post:')).length,
    };
  }

  async subscribe(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return false;
    let added = false;
    await this.subscribers.update((d) => {
      d.emails = d.emails || [];
      if (!d.emails.includes(key)) {
        d.emails.push(key);
        d.addedAt = d.addedAt || {};
        d.addedAt[key] = new Date().toISOString();
        added = true;
      }
      return d;
    });
    return added;
  }

  subscriberCount() { return (this.subscribers.sync().emails || []).length; }
  subscriberList() { return this.subscribers.sync().emails || []; }
}

export function normaliseUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return /^mailto:|^tel:/i.test(raw) ? raw : 'https://' + raw;
  return raw.slice(0, 200);
}

export function hostOf(url) {
  try { return new URL(normaliseUrl(url)).host; } catch { return String(url || '').slice(0, 40); }
}

/** Ultra-cheap spam heuristics – keeps the guestbook human. */
export function spamScore({ message = '', name = '', url = '', email = '' }) {
  let score = 0;
  const links = (String(message).match(/https?:\/\//gi) || []).length;
  score += Math.max(0, links - 1) * 3;
  if (/\b(viagra|casino|crypto|forex|seo service|backlink|porn|escort|loan)\b/i.test(message)) score += 5;
  if ((message.match(/\[url=/gi) || []).length) score += 4;
  if (/<a\s+href/i.test(message)) score += 4;
  if (name.length < 2) score += 2;
  if (/(.)\1{6,}/.test(message)) score += 2;
  if (url && !/\.(com|net|org|io|me|co|xyz|dev|cn|jp|uk|de|fr|ru)/i.test(url)) score += 2;
  if (email && /\S+@\S+/.test(email) === false) score += 1;
  return score;
}
