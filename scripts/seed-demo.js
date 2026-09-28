#!/usr/bin/env node
/**
 * Reset the runtime stores so a fresh clone has something to look at:
 * a few guestbook entries, a couple of subscribers and a believable
 * hit-counter history. Safe to run any time — it only writes data/*.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/lib/paths.js';

const day = 86400000;
const now = Date.now();
const iso = (offsetDays, hour = 11) =>
  new Date(now - offsetDays * day + hour * 3600000).toISOString();

const entries = [
  ['Ada Lovelace', 'London, UK', 'First!! Found you through the Dial-Up Survivors ring. The blinking text is glorious.', 12],
  ['zeldatron', 'Portland, OR', 'this site is a time machine and I am here for it. signed, linked back.', 9],
  ['Grace H.', 'Arlington, VA', 'The chiptune player made me smile out loud at my desk. Respect.', 7],
  ['webmaster@geocities.invalid', 'Tokyo, JP', '你好！写的文章很有意思。DOS终端太酷了。', 5],
  ['Captain Pixel', 'Manchester, UK', 'Bookmarking this for my grandchildren.', 3],
  ['anonymous ftp user', 'the World Wide Web', 'cool page! add me to your webring!!', 1],
].map(([name, location, message, daysAgo], i) => ({
  id: i + 1,
  target: 'guestbook',
  name,
  email: '',
  url: name.includes('.') || name.includes('@') ? 'https://example.com/' + i : '',
  host: name.includes('.') || name.includes('@') ? 'example.com' : '',
  location,
  message,
  date: iso(daysAgo, 9 + i),
  status: i === 4 ? 'pending' : 'approved',
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
    emails: ['ada@example.com', 'zeldatron@example.com', 'grace@example.com'],
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
