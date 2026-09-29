/**
 * The demo stores, as data. Imported by the seed script and by the test
 * that guards the shape: if a field stops matching what Stats reads, the
 * hit counter renders "[object Object]1" instead of a number.
 */
const day = 86400000;
const now = Date.now();
export const iso = (offsetDays, hour = 11) =>
  new Date(now - offsetDays * day + hour * 3600000).toISOString();

const entries = [
  ['阿飞', '中国 上海', '路过你们环形网过来的！页面做得真讲究，访问计数器还在跳，爷青回。', 12, 'approved'],
  ['Ada Lovelace', 'London, UK', 'Found you through the Dial-Up Survivors ring. The blinking cursor is a marvel.', 9, 'approved'],
  ['Grace H.', 'Arlington, VA', 'The chiptune player made me smile out loud at my desk. Signing the book.', 6, 'approved'],
  [' webmaster@geocities.invalid', '日本 東京', '日本語も読めます。DOS ターミナル unstoppable！', 5, 'approved'],
  ['zeldatron', 'Portland, OR', 'this site is a time machine and I am here for it. signed.', 3, 'approved'],
  ['小张', '中国 成都', '朋友推荐的，说这站能下载 .TXT，收藏了！', 2, 'pending'],
].map(([name, location, message, daysAgo, status], i) => ({
  id: i + 1,
  target: 'guestbook',
  name,
  location,
  message,
  status,
  createdAt: iso(daysAgo),
  ip: '',
  userAgent: 'seed',
}));

const comments = [
  ['Reader', 'The Ctrl+K terminal answered `help` on the first try. Unreal.', 4, 'approved'],
  ['阿飞', '转载了 .TXT 版本到我的摇客圈 thanks!', 2, 'approved'],
].map(([name, message, daysAgo, status], i) => ({
  id: 100 + i,
  target: 'post:welcome-to-my-homepage',
  name,
  message,
  status,
  createdAt: iso(daysAgo),
  ip: '',
  userAgent: 'seed',
}));

export const writes = {
  guestbook: { entries: [...entries, ...comments], nextId: 200 },
  subscribers: { list: [{ email: 'ada@example.com', createdAt: iso(30) }] },
  stats: {
    total: 19980,
    days: Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => {
        const d = iso(29 - i);
        const day = d.slice(0, 10);
        return [day, 40 + ((i * 37) % 60)];
        // days[day] is a plain counter, not an object: the store does (days[k]||0)+1
      }),
    ),
    paths: {
      '/': 8402,
      '/posts': 1240,
      '/posts/welcome-to-my-homepage': 611,
      '/guestbook': 402,
      '/tags': 96,
      '/search': 41,
    },
    uniques: { [new Date(now).toISOString().slice(0, 10)]: { abc123: 2, def456: 1 } },
    visits: {},
  },
};
