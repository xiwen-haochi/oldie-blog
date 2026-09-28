import express from 'express';
import { rssFeed, atomFeed, jsonFeed, sitemapXml, robotsTxt, manifestJson } from '../lib/feeds.js';
import { toPlainText } from '../lib/markdown.js';
import { absUrl } from '../lib/config.js';

const FEED_LIMIT = 40;

export function metaRoutes(ctx) {
  const router = express.Router();
  const posts = () => ctx.index.publishedPosts().slice(0, FEED_LIMIT);

  router.get('/feed.xml', (req, res) => {
    res.type('application/rss+xml; charset=utf-8').set('Cache-Control', 'public, max-age=600').send(rssFeed(ctx.site, posts()));
  });

  router.get('/atom.xml', (req, res) => {
    res.type('application/atom+xml; charset=utf-8').set('Cache-Control', 'public, max-age=600').send(atomFeed(ctx.site, posts()));
  });

  router.get('/feed.json', (req, res) => {
    res.type('application/feed+json; charset=utf-8').set('Cache-Control', 'public, max-age=600').send(jsonFeed(ctx.site, posts()));
  });

  router.get('/feed/tag/:tag.xml', (req, res, next) => {
    const list = ctx.index.postsByTag(req.params.tag).slice(0, FEED_LIMIT);
    if (!list.length) return next();
    const tag = req.params.tag;
    res.type('application/rss+xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=600')
      .send(rssFeed({ ...ctx.site, title: ctx.site.title + ' · #' + tag }, list));
  });

  router.get('/sitemap.xml', (req, res) => {
    res.type('application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=3600')
      .send(sitemapXml(ctx.site, { posts: ctx.index.publishedPosts(), pages: ctx.index.pages }));
  });

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=86400').send(robotsTxt(ctx.site));
  });

  router.get('/site.webmanifest', (req, res) => {
    res.type('application/manifest+json; charset=utf-8').send(manifestJson(ctx.site));
  });

  // ---- health + misc endpoints -----------------------------------------
  router.get('/healthz', (req, res) => {
    res.json({ ok: true, uptime: process.uptime(), posts: ctx.index.publishedPosts().length, version: 1 });
  });

  router.get('/llms.txt', (req, res) => {
    const list = ctx.index.publishedPosts().slice(0, 50);
    const lines = [
      '# ' + ctx.site.title,
      '',
      '> ' + ctx.site.description,
      '',
      'A hand-made 1990s personal homepage published as Markdown and served as server-rendered HTML.',
      'Written by ' + ctx.site.author + '. Site: ' + ctx.site.url,
      '',
      '## Posts',
      '',
      ...list.map((p) => '- [' + p.title + '](' + absUrl(ctx.site, p.url) + '): ' + p.description),
      '',
      '## Sections',
      '',
      '- [Archive](' + absUrl(ctx.site, '/archive') + ')',
      '- [Tags](' + absUrl(ctx.site, '/tags') + ')',
      '- [Guestbook](' + absUrl(ctx.site, '/guestbook') + ')',
      '- [About](' + absUrl(ctx.site, '/about') + ')',
      '',
    ];
    res.type('text/plain; charset=utf-8').send(lines.join('\n'));
  });

  router.get('/posts/:slug.json', (req, res, next) => {
    const post = ctx.index.getPost(req.params.slug);
    if (!post) return next();
    res.json({
      title: post.title,
      slug: post.slug,
      url: absUrl(ctx.site, post.url),
      date: post.date.toISOString(),
      updated: post.updated ? post.updated.toISOString() : null,
      description: post.description,
      tags: post.tags,
      readingTime: post.readingTime,
      wordCount: post.wordCount,
      markdown: post.body,
      html: post.html,
      text: toPlainText(post.body),
      plainUrl: absUrl(ctx.site, post.txtUrl),
    });
  });

  return router;
}
