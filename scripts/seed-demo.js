#!/usr/bin/env node
/**
 * Reset the runtime stores so a fresh clone has something to look at:
 * a few guestbook entries, some subscribers and a believable hit-counter
 * history. Safe to run any time — it only writes data/*.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/lib/paths.js';

const day = 86400000;
const now = Date.now();
const iso = (offsetDays, hour = 11) =>
  new Date(now - offsetDays * day + hour * 3600000).toISOString();

const entries = [
  ['阿飞', '中国 上海', '路过你们环形网过来的！页面做得真讲究，访问计数器还在跳，爷青回。', 12, 'approved'],
  ['Ada Lovelace', 'London, UK', 'Found you through the Dial-Up Survivors ring. The blinking text is glorious.', 9, 'approved'],
  ['Grace H.', 'Arlington, VA', 'The chiptune player made me smile out loud at my desk. Respect.', 7, 'approved'],
  [' webmaster@geocities.invalid', '日本 东京', '日本語も読めます。DOS ターミナル unstoppable！', 5, 'approved'],
  ['zeldatron', 'Portland, OR', 'this site is a time machine and I am here for it. signed, linked back.', 4, 'approved'],
  ['小张', '中国 成都', '朋友推荐的，说这站能下载 .TXT，收藏了！', 3, 'pending'],
  ['anonymous ftp user', 'the World Wide Web', 'cool page! add me to your webring!!', 1, 'approved'],
].map(([name, location, message, daysAgo, status], i) => ({
  id: i + 1,
  target: 'guestbook',
  name,
  email: '',
  url: '',
  host: '',
  location,
  message,
  date: iso(daysAgo, 9 + i),
  status,
  ip: '',
  ua: 'seed',
}));

const comments = [
  {
    id: 100,
    target: 'post:welcome-to-my-homepage',
    name: 'Reader Bob',
    email: '',
    url: '',
    host: '',
    location: 'Ohio, US',
    message: 'Ctrl+K worked on the first try. Ten out of ten.',
    date: iso(2, 14),
    status: 'approved',
    ip: '',
    ua: 'seed',
  },
];

const days = {};
for (let i = 29; i >= 0; i--) {
  const key = new Date(now - i * day).toISOString().slice(0, 10);
  days[key] = 6 + Math.floor(Math.abs(Math.sin(i * 1.7)) * 40);
}
days[new Date(now).toISOString().slice(0, 10)] = 3;

const writes = {
  'guestbook.json': { entries: [...entries, ...comments], nextId: 101, updatedAt: new Date().toISOString() },
  'subscribers.json': {
    emails: ['fei@example.com', 'ada@example.com', 'zeldatron@example.com'],
    addedAt: {},
  },
  'stats.json': {
    total: 19980,
    firstSeen: '2025-01-01T00:00:00.000Z',
    days,
    paths: {
      '/': 8123,
      '/posts/welcome-to-my-homepage': 1204,
      '/posts/a-dos-terminal-in-every-webpage': 861,
      '/posts/writing-in-markdown-in-the-year-of-the-terminal': 540,
      '/guestbook': 233,
      '/archive': 122,
      '/tags': 96,
      '/search': 41,
    },
    uniques: { [new Date(now).toISOString().slice(0, 10)]: { abc123: 2, def456: 1 } },
    visits: {},
  },
};

fs.mkdirSync(DATA_DIR, { recursive: true });
for (const [name, data] of Object.entries(writes)) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2) + '\n');
  console.log('wrote data/' + name);
}
console.log('\nDemo stores ready. Run \'pnpm start\' and open the site.');
