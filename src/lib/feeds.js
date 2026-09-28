import { absUrl } from './config.js';
import { formatDate, isoDate } from './text.js';

export const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const cdata = (html) => '<![CDATA[' + String(html).split(']]>').join(']]]]><![CDATA[>') + ']]>';

export function rssFeed(site, posts) {
  const items = posts.map((p) => {
    const url = absUrl(site, p.url);
    return [
      '    <item>',
      '      <title>' + xmlEsc(p.title) + '</title>',
      '      <link>' + url + '</link>',
      '      <guid isPermaLink="true">' + url + '</guid>',
      '      <pubDate>' + formatDate(p.updated || p.date, { style: 'rfc822' }) + '</pubDate>',
      '      <description>' + xmlEsc(p.description) + '</description>',
      '      <content:encoded>' + cdata(p.html) + '</content:encoded>',
      ...(p.tags[0] ? ['      <category>' + xmlEsc(p.tags[0]) + '</category>'] : []),
      '    </item>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    '    <title>' + xmlEsc(site.title) + '</title>',
    '    <link>' + absUrl(site, '/') + '</link>',
    '    <atom:link href="' + absUrl(site, '/feed.xml') + '" rel="self" type="application/rss+xml" />',
    '    <description>' + xmlEsc(site.description) + '</description>',
    '    <language>' + xmlEsc(site.locale) + '</language>',
    '    <copyright>' + new Date().getUTCFullYear() + ' ' + xmlEsc(site.author) + '</copyright>',
    '    <lastBuildDate>' + formatDate(posts[0]?.date || new Date(), { style: 'rfc822' }) + '</lastBuildDate>',
    '    <generator>oldie-blog</generator>',
    '    <ttl>60</ttl>',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function atomFeed(site, posts) {
  const entries = posts.map((p) => {
    const url = absUrl(site, p.url);
    return [
      '  <entry>',
      '    <title>' + xmlEsc(p.title) + '</title>',
      '    <link href="' + url + '" />',
      '    <id>' + url + '</id>',
      '    <published>' + isoDate(p.date) + '</published>',
      '    <updated>' + isoDate(p.updated || p.date) + '</updated>',
      '    <summary type="text">' + xmlEsc(p.description) + '</summary>',
      '    <content type="html">' + cdata(p.html) + '</content>',
      '    <author><name>' + xmlEsc(p.author || site.author) + '</name></author>',
      ...p.tags.map((t) => '    <category term="' + xmlEsc(t) + '" />'),
      '  </entry>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="' + xmlEsc(site.locale) + '">',
    '    <title>' + xmlEsc(site.title) + '</title>',
    '    <subtitle>' + xmlEsc(site.description) + '</subtitle>',
    '    <id>' + absUrl(site, '/') + '</id>',
    '    <link href="' + absUrl(site, '/') + '"/>',
    '    <link rel="self" href="' + absUrl(site, '/feed.xml') + '"/>',
    '    <updated>' + isoDate(posts[0]?.date || new Date()) + '</updated>',
    '    <author><name>' + xmlEsc(site.author) + '</name></author>',
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

export function jsonFeed(site, posts) {
  return JSON.stringify(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: site.title,
      home_page_url: absUrl(site, '/'),
      feed_url: absUrl(site, '/feed.json'),
      description: site.description,
      language: site.locale,
      icon: absUrl(site, '/favicon.svg'),
      favicon: absUrl(site, '/favicon.svg'),
      authors: [{ name: site.author, url: absUrl(site, '/about'), avatar: absUrl(site, '/assets/avatar.svg') }],
      items: posts.map((p) => ({
        id: absUrl(site, p.url),
        url: absUrl(site, p.url),
        title: p.title,
        content_html: p.html,
        content_text: p.plain,
        summary: p.description,
        date_published: isoDate(p.date),
        date_modified: isoDate(p.updated || p.date),
        tags: p.tags,
        reading_time: p.readingTime,
        word_count: p.wordCount,
      })),
    },
    null,
    2,
  );
}

export function sitemapXml(site, { posts = [], pages = [] } = {}) {
  const lastmod = posts[0]?.date;
  const urls = [
    { loc: '/', priority: '1.0', changefreq: 'daily', lastmod },
    { loc: '/posts', priority: '0.9', changefreq: 'daily', lastmod },
    { loc: '/archive', priority: '0.6', changefreq: 'weekly', lastmod },
    { loc: '/tags', priority: '0.6', changefreq: 'weekly' },
    { loc: '/guestbook', priority: '0.7', changefreq: 'weekly' },
    ...pages.map((p) => ({ loc: p.url, priority: '0.5', changefreq: 'monthly', lastmod: p.updated || p.date })),
    ...posts.map((p) => ({
      loc: p.url,
      priority: p.featured ? '0.9' : '0.8',
      changefreq: 'monthly',
      lastmod: p.updated || p.date,
    })),
    ...posts.map((p) => ({ loc: p.url + '.txt', priority: '0.2', changefreq: 'yearly' })),
  ];

  const body = urls
    .map((u) => {
      const parts = ['    <loc>' + xmlEsc(absUrl(site, u.loc)) + '</loc>'];
      if (u.lastmod) parts.push('    <lastmod>' + isoDate(u.lastmod) + '</lastmod>');
      if (u.changefreq) parts.push('    <changefreq>' + u.changefreq + '</changefreq>');
      if (u.priority) parts.push('    <priority>' + u.priority + '</priority>');
      return '  <url>\n' + parts.join('\n') + '\n  </url>';
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    '</urlset>',
    '',
  ].join('\n');
}

export function robotsTxt(site, { disallowAdmin = true } = {}) {
  const lines = [
    '# ' + site.title + ' — robots.txt',
    'User-agent: *',
    'Allow: /',
    'Allow: /assets/',
  ];
  if (disallowAdmin) {
    // NB: the *configured* admin path is deliberately NOT listed. Writing a
    // secret back door into robots.txt is an invitation, not a lock.
    lines.push('Disallow: /admin', 'Disallow: /api/terminal', 'Disallow: /dashboard');
  }
  lines.push('', '# Be a nice bot, this server is one small computer.', 'Crawl-delay: 1', '');
  lines.push('Sitemap: ' + absUrl(site, '/sitemap.xml'));
  try { lines.push('Host: ' + new URL(site.url).host); } catch { /* relative url */ }
  return lines.join('\n') + '\n';
}

export function manifestJson(site) {
  return JSON.stringify(
    {
      name: site.title,
      short_name: site.title.slice(0, 12),
      description: site.description,
      start_url: '/',
      display: 'standalone',
      background_color: '#008080',
      theme_color: '#000080',
      icons: [
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/assets/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      ],
    },
    null,
    2,
  );
}

export function webmanifest(site) {
  return manifestJson(site);
}
