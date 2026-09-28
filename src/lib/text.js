const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
const WORD = /[A-Za-z0-9_'-]+/g;

export function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text = '') {
  const t = String(text);
  const cjk = (t.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/g) || []).length;
  const latin = (t.match(WORD) || []).length;
  return { cjk, latin, total: cjk + latin };
}

/** Reading time that does not embarrass itself on Chinese or English text. */
export function readingTime(text = '', wordsPerMinute = 220, cjkPerMinute = 400) {
  const { cjk, latin } = countWords(text);
  const minutes = latin / wordsPerMinute + cjk / cjkPerMinute;
  return Math.max(1, Math.round(minutes * 10) / 10);
}

/** Display width in "monospace columns": CJK counts double. */
export function plainTextLength(text = '') {
  let n = 0;
  for (const ch of String(text)) n += CJK.test(ch) ? 2 : 1;
  return n;
}

export function slugify(input = '') {
  const s = String(input).trim().toLowerCase();
  return (
    s
      .replace(/['"]/g, '')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

export function truncate(text = '', max = 160) {
  const t = stripHtml(text);
  if (plainTextLength(t) <= max) return t;
  let out = '';
  let len = 0;
  for (const ch of t) {
    const w = CJK.test(ch) ? 2 : 1;
    if (len + w > max - 1) break;
    out += ch;
    len += w;
  }
  return out + '…';
}

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const escapeXml = escapeHtml;

export function attr(str = '') {
  return escapeHtml(str).replace(/\n/g, ' ');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDate(date, { locale = 'en', style = 'long' } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (style === 'iso') return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (style === 'rfc822') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${days[d.getUTCDay()]}, ${String(day).padStart(2, '0')} ${MONTHS[m].slice(0, 3)} ${y} ${hh}:${mm}:${ss} GMT`;
  }
  if (String(locale).toLowerCase().startsWith('zh')) return `${y}年${m + 1}月${day}日`;
  if (style === 'short') return `${MONTHS[m].slice(0, 3)} ${day}, ${y}`;
  return `${day} ${MONTHS[m]} ${y}`;
}

export function isoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function timeAgo(date, locale = 'en') {
  const d = date instanceof Date ? date : new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  const zh = String(locale).toLowerCase().startsWith('zh');
  if (mins < 1) return zh ? '刚刚' : 'just now';
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return zh ? `${days} 天前` : `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return zh ? `${months} 个月前` : `${months}mo ago`;
  return formatDate(d, { locale });
}

export function humanBytes(bytes = 0) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Number(bytes) || 0;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${Math.round(n * 10) / 10} ${units[i]}`;
}

export const pad = (n, len = 2) => String(n).padStart(len, '0');
export const titleCase = (s = '') => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Tokeniser with CJK unigram + bigram support so 中文 queries actually match. */
export function tokenize(text = '') {
  const lower = String(text).toLowerCase();
  const tokens = [];
  const cjk = lower.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g) || [];
  for (const ch of cjk) tokens.push(ch);
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk[i] + cjk[i + 1]);
  for (const w of lower.match(/[a-z0-9][a-z0-9'_-]*/g) || []) {
    if (w.length > 1 || /\d/.test(w)) tokens.push(w);
    if (w.length > 4 && !CJK.test(w)) {
      tokens.push(w.slice(0, w.length - 1));
      tokens.push(w.slice(1));
    }
  }
  return tokens;
}
