import { search, parseQuery } from './search.js';
import { toPlainText } from './markdown.js';
import { formatDate, pad } from './text.js';

const FORTUNES = [
  'A journey of a thousand pages begins with a single hyperlink.',
  'You have 8mm of cassette tape left. Choose wisely.',
  'Never trust a webmaster who says "it works on my machine".',
  'The best backup is the one you have not needed yet.',
  'Someone is reading this in 2025. Be kind.',
  'It renders. Ship it.',
  'Loading... please stop refreshing, it does not help.',
  'There is no place like 127.0.0.1.',
  'As long as the modem light blinks, the dream lives.',
  'Write the docs you wish you had found.',
  'A site is a garden. Most visitors are butterflies.',
  'Turn it off and on again. It is 1998, this works.',
  'Your HTML is valid. Nobody checked, but still.',
];

export const COMMANDS = [
  ['help', 'show this list'],
  ['dir [folder]', 'list posts (folder: posts, tags, ring, guestbook)'],
  ['cd <folder>', 'change directory (posts, tags, ring, guestbook, home)'],
  ['type <slug>', 'print a post as plain text'],
  ['search <query>', 'full text search, try tag:foo or "a phrase"'],
  ['ls / cat', 'shortcuts for dir / type'],
  ['posts', 'latest five dispatches'],
  ['tags', 'every tag with counts'],
  ['stats', 'hit counter, uptime and content totals'],
  ['whoami', 'who is running this session'],
  ['about', 'about this site and its author'],
  ['colophon', 'how this page is built'],
  ['fortune', 'a wise saying from the archives'],
  ['date', 'current server date and time'],
  ['ver', 'software version'],
  ['neofetch', 'system info, ASCII style'],
  ['uptime', 'how long the server has been up'],
  ['ping <host>', 'ping the local web server'],
  ['music [on|off]', 'toggle the chiptune theme'],
  ['theme [1998|classic]', 'toggle Time Machine mode'],
  ['open <url>', 'open a path in the browser'],
  ['clear', 'clear the screen'],
  ['exit', 'close the terminal'],
];

export function uptimeText(since) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + sec + 's';
}

/**
 * The DOS terminal runs real commands against the real site index, so what it
 * prints is always true. Lines carry a class hint the browser colours.
 */
export function runCommand(ctx, raw, req = {}) {
  const line = String(raw == null ? '' : raw).trim();
  const out = [];
  const push = (text, cls) => out.push({ text: String(text), cls: cls || '' });

  if (!line) return out;
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help':
    case '?':
      push('AVAILABLE COMMANDS', 'hi');
      push('');
      COMMANDS.forEach(function (row) { push('  ' + row[0].padEnd(20) + row[1]); });
      push('');
      push('Tip: "type <slug>" prints any post in plain text.', 'dim');
      break;

    case 'ver':
    case 'version':
      push('oldie-blog [Version 0.1.0]', 'hi');
      const y = new Date().getFullYear();
      const since = String(ctx.site.since || y);
      push('(c) ' + (since === String(y) ? y : since + '-' + y) + '. Markdown in, HTML out, built on one small computer.');
      break;

    case 'neofetch': {
      const stats = ctx.stats.summary();
      const art = [
        '_______________________',
       '|  _________________  |',
       '| |  _     _     _   | |',
       '| | | |   | |   | | | |',
       '| |_|___|___|___|_|_| | |',
       '|  ___________     |  |',
       '| |___________|    |  |',
       '|___________________| |',
       '|_____________________|',
      ];
      push(art.join('\n'), 'dim');
      push('  ' + ctx.site.title + '@oldie-web');
      push('  OS: node ' + process.versions.node + ' on ' + process.platform);
      push('  Shell: msdos 1.0     Resolution: ' + (req.screen || '800x600'));
      push('  Uptime: ' + uptimeText(ctx.startedAt));
      push('  Posts: ' + ctx.index.publishedPosts().length + '  Words: ' + ctx.index.totalWords());
      push('  Hits: ' + stats.total + '  Unique today: ' + stats.unique);
      push('  Theme: classic  Terminal: DOS 2.11  Tracker: none');
      break;
    }

    case 'date':
    case 'time':
      push('Server date : ' + new Date().toString());
      push('UTC         : ' + new Date().toISOString());
      break;

    case 'uptime':
      push('up ' + uptimeText(ctx.startedAt) + '  (' + Math.floor(process.uptime()) + 's process uptime)');
      break;

    case 'whoami':
      push('visitor ' + String(req.visitorId || 'unknown').slice(0, 8) + ' from ' + (req.geoGuess || 'somewhere'));
      push('online now: ' + ctx.stats.summary().online + '   your visit: #' + (req.sessionRank || 1));
      break;

    case 'about':
      push(ctx.site.title, 'hi');
      push(ctx.site.description);
      push('');
      push('Webmaster : ' + ctx.site.author);
      push('Email     : ' + ctx.site.email);
      push('Home      : ' + ctx.site.url);
      push('Since     : ' + (ctx.site.since || new Date().getFullYear()));
      break;

    case 'colophon':
      push('HOW THIS PAGE IS BUILT', 'hi');
      push('');
      push('  Content ....... ' + ctx.index.publishedPosts().length + ' Markdown files in content/posts/');
      push('  Renderer ....... markdown-it + highlight.js');
      push('  Server ......... node ' + process.versions.node + ' + express, zero native deps');
      push('  Search ......... in-memory inverted index, CJK aware');
      push('  Storage ........ JSON stores in data/ (git friendly)');
      push('  Sounds .......... square waves generated live by the Web Audio API');
      push('  Tracking ....... none, just one anonymous visitor id cookie');
      break;

    case 'fortune':
      push(FORTUNES[Math.floor(Math.random() * FORTUNES.length)], 'warn');
      break;

    case 'dir':
    case 'ls': {
      const folder = String(parts[1] || 'posts').toLowerCase();
      if (folder === 'tags' || folder === 'ring' || folder === 'guestbook') return runCommand(ctx, folder, req);
      const posts = ctx.index.publishedPosts();
      push('Volume in drive C is OLDIE');
      push(' Directory of C:\\OLDIE\\POSTS');
      push('');
      push('POSTS.TXT  ' + posts.length + ' files  ' + ctx.index.totalWords() + ' words  ' + formatDate(ctx.startedAt, { style: 'iso' }));
      push('');
      push('  SIZE  DATE        NAME');
      push('  ' + '-'.repeat(58));
      posts.forEach(function (p) {
        const d = p.date;
        const when = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
        const size = String(p.charCount).padStart(5);
        const flag = p.draft ? '[DRAFT] ' : '';
        push(size + '  ' + when + '  ' + flag + p.slug + (p.tags.length ? '   #' + p.tags.join(' #') : ''));
      });
      push('');
      push('  ' + posts.length + ' file(s)   ' + ctx.index.totalWords() + ' words');
      break;
    }

    case 'cd': {
      const target = String(arg || '').toLowerCase();
      if (!target) { push('C:\\OLDIE>'); break; }
      if (target === '..' || target === 'home' || target === '\\' || target === '/') { push('C:\\OLDIE>'); break; }
      if (target === 'posts') return runCommand(ctx, 'dir posts', req);
      if (target === 'ring' || target === 'webring') return runCommand(ctx, 'ring', req);
      if (target === 'tags' || target === 'guestbook') return runCommand(ctx, target, req);
      push('The system cannot find the path specified.', 'err');
      push('Available: posts, tags, ring, guestbook, home', 'dim');
      break;
    }

    case 'type':
    case 'cat':
    case 'more': {
      const slug = String(parts[1] || '');
      if (!slug) { push('type: usage - type <slug>', 'err'); break; }
      const post = ctx.index.getPost(slug);
      if (!post) {
        push('type: cannot find ' + slug, 'err');
        push('Run "dir" to see what is on this disk.', 'dim');
        break;
      }
      push('='.repeat(58), 'dim');
      push(post.title, 'hi');
      push(formatDate(post.date, { locale: ctx.site.locale }) + '   ' + post.readingTime + ' min read', 'dim');
      push('='.repeat(58), 'dim');
      toPlainText(post.body).split('\n').forEach(function (para) { push(para); });
      push('');
      push('[ open ' + post.url + ' ]', 'dim');
      break;
    }

    case 'posts':
    case 'latest': {
      push('LATEST 5 DISPATCHES', 'hi');
      ctx.index.publishedPosts().slice(0, 5).forEach(function (p) {
        push('');
        push(p.title, 'hi');
        push('  ' + formatDate(p.date, { locale: ctx.site.locale, style: 'short' }) + '  ·  ' + p.readingTime + ' min  ·  ' + p.url);
      });
      break;
    }

    case 'tags': {
      const tags = ctx.index.allTags();
      push('TAGS (' + tags.length + ')', 'hi');
      tags.forEach(function (t) {
        push('  #' + t.name + '  ' + t.count + ' post' + (t.count === 1 ? '' : 's') + '   →  /tags/' + t.slug);
      });
      break;
    }

    case 'ring':
    case 'webring': {
      const list = ctx.site.webring || [];
      push('THE WEBRING (' + list.length + ' members)', 'hi');
      list.forEach(function (m, i) {
        push('  ' + pad(i + 1) + '. ' + m.title);
        push('     ' + m.url + (m.note ? '   // ' + m.note : ''));
      });
      break;
    }

    case 'guestbook':
    case 'gb': {
      const entries = ctx.community.entries({ target: 'guestbook', limit: 8 });
      push('GUESTBOOK - ' + ctx.community.count({ target: 'guestbook' }) + ' entries, ' + entries.length + ' shown', 'hi');
      if (!entries.length) push('  (nobody has signed yet - be the first)', 'dim');
      entries.forEach(function (e) {
        push('');
        push('  ' + e.name + '  ·  ' + (e.location || 'unknown') + '  ·  ' + formatDate(e.date, { style: 'short' }), 'warn');
        push('    ' + String(e.message).split('\n')[0].slice(0, 90));
      });
      break;
    }

    case 'stats': {
      const s = ctx.stats.summary();
      push('SITE STATISTICS', 'hi');
      push('  total hits ....... ' + s.total);
      push('  today ............ ' + s.today);
      push('  unique today ..... ' + s.unique);
      push('  online right now .. ' + s.online);
      push('  posts ............ ' + ctx.index.publishedPosts().length + ' (' + ctx.index.allPosts().filter(function (p) { return p.draft; }).length + ' draft)');
      push('  words written .... ' + ctx.index.totalWords());
      push('  tags ............. ' + ctx.index.allTags().length);
      push('  guestbook ........ ' + ctx.community.count({ target: 'guestbook' }) + ' signed, ' + ctx.community.stats().pending + ' pending');
      push('  subscribers ...... ' + ctx.community.subscriberCount());
      push('  uptime ........... ' + uptimeText(ctx.startedAt));
      break;
    }

    case 'search':
    case 'find':
    case 'grep': {
      if (!arg) { push('search: tell me what to look for. try: search tag:markdown', 'err'); break; }
      const results = search(ctx.searchIndex, parseQuery(arg), 10);
      push('SEARCH: ' + arg, 'hi');
      push('  ' + results.length + ' result' + (results.length === 1 ? '' : 's'));
      results.forEach(function (r) {
        push('');
        push('  ' + r.title, 'hi');
        push('    ' + r.url + '   ' + r.readingTime + ' min');
        push('    ' + String(r.snippet).replace(/<[^>]+>/g, '').slice(0, 130), 'dim');
      });
      if (!results.length) push('  nothing found. try fewer words.', 'warn');
      break;
    }

    case 'ping': {
      const host = arg || String(ctx.site.url).replace(/^https?:\/\//, '');
      push('Pinging ' + host + ' with 32 bytes of data:');
      const ms = 1 + Math.floor(Math.random() * 4);
      push('Reply from ' + host + ': bytes=32 time=' + ms + 'ms TTL=54');
      push('');
      push('Ping statistics: Sent = 1, Received = 1, Lost = 0 (0% loss)');
      break;
    }

    case 'music':
      push('the chiptune player lives in your browser, not here.', 'dim');
      break;

    case 'theme':
      push('Time Machine mode is toggled in your browser, not here.', 'dim');
      break;

    case 'open':
    case 'start':
      push('[ open ' + (arg || '/') + ' ]', 'warn');
      break;

    case 'clear':
    case 'cls':
      out.push({ text: '', cls: 'clear' });
      break;

    case 'exit':
    case 'quit':
      push('bye', 'dim');
      break;

    case 'sudo':
      push('nice try.', 'err');
      break;

    default:
      push('Bad command or file name', 'err');
      push('Type "help" to see what this machine understands.', 'dim');
  }

  return out;
}
