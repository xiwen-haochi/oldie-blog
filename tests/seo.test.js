import test from 'node:test';
import assert from 'node:assert/strict';

import { rssFeed, atomFeed, jsonFeed, sitemapXml, robotsTxt, manifestJson, xmlEsc } from '../src/lib/feeds.js';
import { pageMeta, blogPostingLd, websiteLd, breadcrumbLd } from '../src/lib/seo.js';
import { absUrl, deepMerge } from '../src/lib/config.js';

const site = {
  title: 'Oldie Blog',
  description: 'A 1990s personal homepage',
  author: 'The Webmaster',
  email: 'me@example.com',
  url: 'http://localhost:4173',
  locale: 'en',
};

const posts = [
  {
    slug: 'hello',
    title: 'Hello & <World>',
    url: '/posts/hello',
    description: 'First post',
    tags: ['intro', 'meta'],
    date: new Date('2025-01-02T00:00:00Z'),
    updated: null,
    wordCount: 120,
    readingTime: 1,
    cover: '',
    author: '',
    html: '<p>Body</p>',
    plain: 'Body',
    featured: true,
  },
];

test('absUrl never doubles slashes', () => {
  assert.equal(absUrl(site, '/posts/hello'), 'http://localhost:4173/posts/hello');
  assert.equal(absUrl(site, 'posts/hello'), 'http://localhost:4173/posts/hello');
  assert.equal(absUrl(site, 'https://other.test/x'), 'https://other.test/x');
});

test('deepMerge merges objects and replaces arrays', () => {
  const merged = deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 }, e: 4 });
  assert.deepEqual(merged, { a: 1, b: { c: 9, d: 3 }, e: 4 });
  assert.deepEqual(deepMerge({ list: [1, 2] }, { list: [3] }), { list: [3] });
});

test('rssFeed is valid-ish XML with escaped titles', () => {
  const xml = rssFeed(site, posts);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2.0"/);
  assert.match(xml, /Hello &amp; &lt;World&gt;/);
  assert.match(xml, /<pubDate>Thu, 02 Jan 2025 00:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<atom:link/);
  assert.match(xml, /<guid isPermaLink="true">http:\/\/localhost:4173\/posts\/hello<\/guid>/);
});

test('rssFeed escapes CDATA terminators', () => {
  const nasty = [{ ...posts[0], html: '<p>a]]>b</p>' }];
  const xml = rssFeed(site, nasty);
  assert.ok(!xml.includes('a]]>b'), 'raw ]]> inside CDATA');
  assert.match(xml, /]]]]><!\[CDATA\[>/);
});

test('atomFeed is a valid atom document', () => {
  const xml = atomFeed(site, posts);
  assert.match(xml, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom"/);
  assert.match(xml, /<published>2025-01-02T00:00:00.000Z<\/published>/);
  assert.match(xml, /<category term="intro" \/>/);
});

test('jsonFeed follows the 1.1 spec shape', () => {
  const feed = JSON.parse(jsonFeed(site, posts));
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].id, 'http://localhost:4173/posts/hello');
  assert.ok(feed.items[0].content_html);
  assert.ok(feed.items[0].content_text);
  assert.deepEqual(feed.items[0].tags, ['intro', 'meta']);
});

test('sitemap lists posts, pages and the txt twins', () => {
  const xml = sitemapXml(site, { posts, pages: [{ url: '/about', date: new Date('2025-01-01') }] });
  assert.match(xml, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/);
  assert.match(xml, /<loc>http:\/\/localhost:4173\/<\/loc>/);
  assert.match(xml, /<loc>http:\/\/localhost:4173\/posts\/hello<\/loc>/);
  assert.match(xml, /<loc>http:\/\/localhost:4173\/posts\/hello.txt<\/loc>/);
  assert.match(xml, /<priority>0.9<\/priority>/);
  assert.match(xml, /<lastmod>2025-01-02T00:00:00.000Z<\/lastmod>/);
});

test('robots.txt blocks admin and points at the sitemap', () => {
  const txt = robotsTxt(site);
  assert.match(txt, /User-agent: \*/);
  assert.match(txt, /Disallow: \/admin/);
  assert.match(txt, /Sitemap: http:\/\/localhost:4173\/sitemap.xml/);
  assert.match(txt, /Crawl-delay: 1/);
});

test('manifest is valid json with the retro palette', () => {
  const m = JSON.parse(manifestJson(site));
  assert.equal(m.name, 'Oldie Blog');
  assert.equal(m.background_color, '#008080');
  assert.ok(m.icons.length >= 1);
});

test('xmlEsc covers the five entities', () => {
  assert.equal(xmlEsc('<a href="x">&' + String.fromCharCode(39) + '</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
});

test('pageMeta builds canonical, robots and og image', () => {
  const meta = pageMeta(site, { title: 'A post', description: 'desc', url: '/posts/a', type: 'article' });
  assert.equal(meta.canonicalUrl, 'http://localhost:4173/posts/a');
  assert.equal(meta.fullTitle, 'A post | Oldie Blog');
  assert.match(meta.robots, /index, follow/);
  assert.equal(meta.ogImage, 'http://localhost:4173/assets/og-default.svg');
  const hidden = pageMeta(site, { noindex: true });
  assert.equal(hidden.robots, 'noindex, nofollow');
});

test('BlogPosting JSON-LD carries the fields search engines read', () => {
  const ld = blogPostingLd(site, posts[0]);
  assert.equal(ld['@type'], 'BlogPosting');
  assert.equal(ld.headline, 'Hello & <World>');
  assert.equal(ld.datePublished, '2025-01-02T00:00:00.000Z');
  assert.equal(ld.author['@type'], 'Person');
  assert.equal(ld.publisher.logo['@type'], 'ImageObject');
  assert.equal(ld.wordCount, 120);
  assert.ok(Array.isArray(ld.image));
  assert.ok(ld.keywords.includes('intro'));
});

test('WebSite JSON-LD advertises a SearchAction', () => {
  const ld = websiteLd(site);
  assert.equal(ld['@type'], 'WebSite');
  assert.equal(ld.potentialAction['@type'], 'SearchAction');
  assert.match(ld.potentialAction.target.urlTemplate, /search\?q=\{search_term_string\}/);
});

test('BreadcrumbList positions start at one', () => {
  const ld = breadcrumbLd(site, [{ name: 'Home', href: '/' }, { name: 'Posts', href: '/posts' }]);
  assert.equal(ld.itemListElement[0].position, 1);
  assert.equal(ld.itemListElement[1].item, 'http://localhost:4173/posts');
});
