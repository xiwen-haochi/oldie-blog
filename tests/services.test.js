import test from 'node:test';
import assert from 'node:assert/strict';

import { Stats } from '../src/lib/stats.js';
import { Community, spamScore, normaliseUrl, hostOf } from '../src/lib/community.js';
import { hashPassword, verifyPassword } from '../src/lib/auth.js';
import { runCommand, uptimeText } from '../src/lib/terminal.js';
import { Sessions } from '../src/lib/sessions.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldie-stats-'));

const fakeCtx = {
  site: { title: 'Test Site', description: 'd', author: 'me', email: 'me@x.test', url: 'http://x.test', webring: [{ title: 'A', url: 'https://a.test', note: 'n' }], since: '1998' },
  index: {
    publishedPosts: () => [{ slug: 'hello', title: 'Hello', url: '/posts/hello', tags: ['x'], date: new Date('2025-01-01'), wordCount: 100, readingTime: 1, charCount: 100, body: 'Hello from the terminal.', plain: 'Hello from the terminal.', draft: false }],
    allPosts: () => [],
    postsByTag: () => [],
    getPost: (slug) => fakeCtx.index.publishedPosts().find((p) => p.slug === slug) || null,
    allTags: () => [{ slug: 'x', name: 'x', count: 1 }],
    totalWords: () => 100,
  },
  stats: { summary: () => ({ total: 5, today: 1, unique: 1, online: 1 }) },
  community: {
    count: () => 0,
    entries: () => [],
    subscriberCount: () => 0,
    moderationQueue: () => [],
    stats: () => ({ pending: 0 }),
  },
  startedAt: Date.now() - 65000,
};

test('hit counter increments totals, days and paths', async () => {
  const stats = new Stats({ file: path.join(tmp, 'stats.json') });
  const first = await stats.hit({ path: '/', ip: '1.1.1.1', ua: 'x', visitorId: 'abc123', count: false });
  assert.equal(first.total, 1998, 'starts from the seed year');
  const counted = await stats.hit({ path: '/posts/hello', ip: '1.1.1.1', ua: 'x', visitorId: 'abc123' });
  assert.equal(counted.total, 1999);
  assert.equal(counted.today, 1);
  assert.deepEqual(stats.topPaths(), [{ path: '/posts/hello', count: 1 }]);
  assert.equal(stats.summary().unique, 1);
});

test('community adds entries and keeps ids', async () => {
  const community = new Community({ file: path.join(tmp, 'guestbook.json'), subscribersFile: path.join(tmp, 'subscribers.json') });
  await community.add({ target: 'guestbook', name: 'Ada', message: 'hi', url: 'example.com' });
  await community.add({ target: 'post:hello', name: 'Grace', message: 'nice' });
  assert.equal(community.entries({ target: 'guestbook', status: 'all' }).length, 1);
  assert.equal(community.entries({ target: 'post:hello', status: 'all' }).length, 1);
  assert.equal(community.entries({ target: 'guestbook', status: 'all' })[0].host, 'example.com');
  const pending = community.moderationQueue();
  assert.equal(pending.length, 2, 'new entries wait for moderation');
  assert.equal(community.count({ target: 'guestbook' }), 0, 'nothing is public before approval');
  const gbEntry = pending.find((e) => e.target === 'guestbook');
  await community.setStatus(gbEntry.id, 'approved');
  assert.equal(community.count({ target: 'guestbook' }), 1);
  await community.setStatus(gbEntry.id, 'spam');
  assert.equal(community.count({ target: 'guestbook' }), 0, 'spam is hidden again');
  await community.remove(gbEntry.id);
  assert.equal(community.entries({ target: 'guestbook', status: 'all' }).length, 0);
});

test('subscribe is idempotent', async () => {
  const community = new Community({ file: path.join(tmp, 'g2.json'), subscribersFile: path.join(tmp, 's2.json') });
  assert.equal(await community.subscribe('a@b.test'), true);
  assert.equal(await community.subscribe('a@b.test'), false);
  assert.equal(community.subscriberCount(), 1);
});

test('spam scoring flags link farms and keyword stuffing', () => {
  assert.equal(spamScore({ message: 'a friendly hello', name: 'Ada' }), 0);
  assert.ok(spamScore({ message: 'viagra casino forex loan', name: 'x' }) >= 5);
  assert.ok(spamScore({ message: 'http://a.test http://b.test http://c.test', name: 'x' }) >= 6);
  assert.ok(spamScore({ message: '[url=spammer]', name: 'x' }) >= 4);
});

test('url normalisation adds a scheme and extracts the host', () => {
  assert.equal(normaliseUrl('example.com'), 'https://example.com');
  assert.equal(hostOf('example.com'), 'example.com');
  assert.equal(normaliseUrl(''), '');
});

test('password hashing is salted and verifiable', () => {
  const hash = hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword('correct horse battery', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.notEqual(hashPassword('same'), hashPassword('same'), 'salts must differ');
});

test('session cookies are signed and tamper-evident', () => {
  const sessions = new Sessions({ secret: 'test-secret' });
  const res = { cookie() {}, clearCookie() {} };
  const token = sessions.issue(res, { user: 'admin' });
  assert.ok(token.includes('.'));
  const req = { headers: { cookie: 'oldie_session=' + token }, socket: {} };
  const read = sessions.read(req, { locals: {} });
  assert.equal(read.user, 'admin');
  const forged = { headers: { cookie: 'oldie_session=' + token.split('.')[0] + '.tampered' }, socket: {} };
  assert.equal(sessions.read(forged, { locals: {} }), null);
});

test('terminal commands answer from real data', () => {
  const out = runCommand(fakeCtx, 'dir').map((l) => l.text).join('\n');
  assert.match(out, /hello/);
  assert.match(out, /Directory of/);
  const help = runCommand(fakeCtx, 'help').map((l) => l.text).join('\n');
  assert.match(help, /AVAILABLE COMMANDS/);
  const stats = runCommand(fakeCtx, 'stats').map((l) => l.text).join('\n');
  assert.match(stats, /total hits/);
  const unknown = runCommand(fakeCtx, 'frobnicate');
  assert.equal(unknown[0].text, 'Bad command or file name');
  const ver = runCommand(fakeCtx, 'ver')[0].text;
  assert.match(ver, /oldie-blog/);
});

test('terminal dir, type and cd work', () => {
  const typed = runCommand(fakeCtx, 'type hello').map((l) => l.text).join('\n');
  assert.match(typed, /Hello/);
  const missing = runCommand(fakeCtx, 'type nope')[0];
  assert.match(missing.text, /cannot find/);
  const cd = runCommand(fakeCtx, 'cd nowhere')[0].text;
  assert.match(cd, /cannot find the path/i);
  const fortune = runCommand(fakeCtx, 'fortune');
  assert.equal(typeof fortune[0].text, 'string');
  assert.ok(fortune[0].text.length > 10);
});

test('uptimeText formats days, hours, minutes and seconds', () => {
  assert.match(uptimeText(Date.now() - 90000), /1m 30s/);
  assert.match(uptimeText(Date.now() - 3725000), /1h 2m/);
});
