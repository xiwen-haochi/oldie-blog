import express from 'express';
import { pageMeta, blogPostingLd, websiteLd, personLd, breadcrumbLd, collectionLd } from '../lib/seo.js';
import { enrichLocals } from '../lib/present.js';
import { paginate } from '../lib/posts.js';
import { search, parseQuery } from '../lib/search.js';
import { toPlainText } from '../lib/markdown.js';
import { checkCsrf } from '../lib/sessions.js';
import { spamScore } from '../lib/community.js';
import { formatDate, isoDate, slugify } from '../lib/text.js';
import { makeTranslator } from '../lib/i18n.js';

export function siteRoutes(ctx) {
  const router = express.Router();
  // localised meta text: ?lang= wins, then the cookie, then the site config
  const tr = (req) => makeTranslator((req && req.locale) || ctx.site.locale || 'zh-CN');

  const render = (res, view, locals) => res.render('pages/' + view, locals);

  /* ------------------------------------------------------------- home */
  router.get('/', (req, res) => {
    // every pinned post belongs in the pinned section, and the list below
    // excludes them. Taking only one left older pins stranded in the list,
    // still wearing their badge, which read as a duplicate.
    const featuredPosts = ctx.index.featured();
    const featuredSlugs = new Set(featuredPosts.map((p) => p.slug));
    const posts = ctx.index.publishedPosts().filter((p) => !featuredSlugs.has(p.slug));
    const perPage = ctx.site.postsPerPage || 8;
    const pager = paginate(posts, req.query.page, perPage);
    const page = pageMeta(ctx.site, {
      title: '',
      description: ctx.site.description,
      url: req.query.page ? '/?page=' + pager.page : '/',
      jsonLd: [websiteLd(ctx.site)],
    });
    res.render('pages/home', enrichLocals(ctx, req, res, {
      page,
      pager,
      pagerUrl: (n) => '/?page=' + n,
      featured: featuredPosts,
      recent: ctx.index.newest(5),
    }));
  });

  /* ------------------------------------------------------- post index */
  router.get('/posts', (req, res) => {
    const t = tr(req);
    const posts = ctx.index.list();
    const pager = paginate(posts, req.query.page, ctx.site.postsPerPage || 8);
    const page = pageMeta(ctx.site, {
      title: 'All dispatches',
      description: t('meta.posts', { site: ctx.site.title }),
      url: pager.page > 1 ? '/posts?page=' + pager.page : '/posts',
      prevUrl: pager.hasPrev ? '/posts?page=' + pager.prev : '',
      nextUrl: pager.hasNext ? '/posts?page=' + pager.next : '',
      jsonLd: [collectionLd(ctx.site, { name: t('posts.title'), description: t('meta.posts', { site: ctx.site.title }), url: '/posts' })],
    });
    res.render('pages/posts', enrichLocals(ctx, req, res, {
      page, pager, pagerUrl: (n) => '/posts?page=' + n, featured: [],
    }));
  });

  /* ----------------------------------------------------- single post */
  router.get('/posts/:slug.txt', (req, res, next) => {
    const post = ctx.index.getPost(req.params.slug);
    if (!post) return next();
    const header = [
      '='.repeat(62),
      ' TITLE : ' + post.title,
      ' DATE  : ' + formatDate(post.date, { locale: ctx.site.locale }),
      ' TAGS  : ' + (post.tags.join(', ') || '(none)'),
      ' URL   : ' + ctx.site.url + post.url,
      ' WORDS : ' + post.wordCount + '   READ: ' + post.readingTime + ' min',
      '='.repeat(62),
      '',
      toPlainText(post.body),
      '',
      '--',
      'Posted by ' + (post.author || ctx.site.author) + ' on ' + ctx.site.url,
      'Saved in plain text for the glory days.',
      '',
    ].join('\n');
    res.type('text/plain; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="' + post.slug + '.txt"')
      .send(header);
  });

  router.get('/posts/:slug', (req, res, next) => {
    const post = ctx.index.getPost(req.params.slug);
    if (!post) return next();
    ctx.stats.hit({ path: post.url, ip: req.clientIp, ua: req.get('user-agent'), visitorId: req.visitorId, count: !res.locals.counted });
    res.locals.counted = true;

    const comments = ctx.community.entries({ target: 'post:' + post.slug });
    const neighbours = ctx.index.neighbours(post);
    const page = pageMeta(ctx.site, {
      title: post.title,
      description: post.description,
      url: post.url,
      type: 'article',
      image: post.cover,
      publishedAt: isoDate(post.date),
      updatedAt: isoDate(post.updated || post.date),
      tags: post.tags,
      keywords: post.keywords,
      noindex: post.noindex,
      canonical: post.canonical,
      windowTitle: post.title,
      jsonLd: [
        blogPostingLd(ctx.site, post),
        breadcrumbLd(ctx.site, [
          { name: 'Home', href: '/' },
          { name: 'Posts', href: '/posts' },
          { name: post.title, href: post.url },
        ]),
      ],
    });
    res.render('pages/post', enrichLocals(ctx, req, res, {
      page, post, comments, commentCount: comments.length, neighbours,
      related: ctx.index.related(post, 3),
    }));
  });

  /* --------------------------------------------------------- archive */
  router.get('/archive', (req, res) => {
    const t = tr(req);
    const posts = ctx.index.list();
    const page = pageMeta(ctx.site, {
      title: 'Archive',
      description: t('meta.archive', { site: ctx.site.title }),
      url: '/archive',
      jsonLd: [breadcrumbLd(ctx.site, [{ name: 'Home', href: '/' }, { name: 'Archive', href: '/archive' }])],
    });
    res.render('pages/archive', enrichLocals(ctx, req, res, {
      page,
      timeline: ctx.index.timeline(),
      tags: ctx.index.allTags(),
      totalCount: posts.length,
      oldest: posts[posts.length - 1] || null,
    }));
  });

  /* ------------------------------------------------------------ tags */
  router.get('/tags', (req, res) => {
    const t = tr(req);
    const page = pageMeta(ctx.site, {
      title: 'Tags',
      description: t('meta.tags', { site: ctx.site.title }),
      url: '/tags',
      jsonLd: [breadcrumbLd(ctx.site, [{ name: 'Home', href: '/' }, { name: 'Tags', href: '/tags' }])],
    });
    res.render('pages/tags', enrichLocals(ctx, req, res, { page, tags: ctx.index.allTags() }));
  });

  router.get('/tags/:tag', (req, res, next) => {
    const t = tr(req);
    const posts = ctx.index.postsByTag(req.params.tag);
    if (!posts.length) return next();
    const tag = ctx.index.allTags().find((t) => t.slug === slugify(req.params.tag)) || { name: req.params.tag, slug: slugify(req.params.tag), count: posts.length };
    const pager = paginate(posts, req.query.page, ctx.site.postsPerPage || 8);
    const page = pageMeta(ctx.site, {
      title: '#' + tag.name,
      description: posts.length + ' posts tagged ' + tag.name + ' on ' + ctx.site.title + '.',
      url: '/tags/' + tag.slug,
      jsonLd: [collectionLd(ctx.site, { name: '#' + tag.name, description: t('meta.tagged', { n: pager.total, tag: tag.name }), url: '/tags/' + tag.slug })],
    });
    res.render('pages/tag', enrichLocals(ctx, req, res, {
      page, tag, pager, pagerUrl: (n) => '/tags/' + tag.slug + '?page=' + n,
    }));
  });

  /* ---------------------------------------------------------- search */
  router.get('/search', (req, res, next) => {
    if (!ctx.site.features.search) return next();
    const t = tr(req);
    const q = String(req.query.q || '').slice(0, 120);
    const results = q ? search(ctx.searchIndex, parseQuery(q), 40) : [];
    const page = pageMeta(ctx.site, {
      title: q ? 'Search: ' + q : 'Search',
      description: t('meta.search', { site: ctx.site.title }),
      url: '/search',
      noindex: true,
      jsonLd: [breadcrumbLd(ctx.site, [{ name: 'Home', href: '/' }, { name: 'Search', href: '/search' }])],
    });
    res.render('pages/search', enrichLocals(ctx, req, res, {
      page, query: q, results, tags: ctx.index.allTags(), parsed: parseQuery(q),
    }));
  });

  /* ------------------------------------------------------- guestbook */
  router.get('/guestbook', (req, res) => {
    const t = tr(req);
    const all = ctx.community.entries({ target: 'guestbook', status: 'approved' });
    const pager = paginate(all, req.query.page, 20);
    const page = pageMeta(ctx.site, {
      title: 'Guestbook',
      description: t('meta.guestbook', { author: ctx.site.author }),
      url: '/guestbook',
      jsonLd: [breadcrumbLd(ctx.site, [{ name: 'Home', href: '/' }, { name: 'Guestbook', href: '/guestbook' }])],
    });
    res.render('pages/guestbook', enrichLocals(ctx, req, res, {
      page,
      entries: pager.items,
      pager,
      pagerUrl: (n) => '/guestbook?page=' + n,
      pendingCount: ctx.community.moderationQueue().length,
      spamCount: ctx.community.stats().spam,
    }));
  });

  router.post('/guestbook', async (req, res, next) => {
    if (!ctx.site.features.guestbook) return next();
    if (!checkCsrf(req, req.body._csrf)) return next(Object.assign(new Error('bad csrf'), { status: 403 }));
    const honeypot = String(req.body.website || '');
    const spam = spamScore(req.body);
    if (honeypot || spam >= 6) {
      res.locals.flash = { type: 'ok', text: 'Thanks! Your entry is in the moderation queue.' };
      return res.redirect('/guestbook#sign');
    }
    await ctx.community.add({
      target: 'guestbook',
      name: req.body.name,
      email: req.body.email,
      url: req.body.url,
      location: req.body.location || req.geoGuess,
      message: req.body.message,
      ip: req.clientIp,
      ua: req.get('user-agent'),
      autoApprove: !ctx.site.features.moderateGuestbook && spam < 3,
    });
    res.locals.flash = { type: 'ok', text: tr(req)('gb.signed') };
    res.redirect('/guestbook#sign');
  });

  /* --------------------------------------------------------- comments */
  router.post('/comments', async (req, res, next) => {
    if (!ctx.site.features.comments) return next();
    const post = ctx.index.getPost(String(req.body.post || ''));
    if (!post) return next();
    if (!checkCsrf(req, req.body._csrf)) return next(Object.assign(new Error('bad csrf'), { status: 403 }));
    const spam = spamScore(req.body);
    if (String(req.body.website || '') || spam >= 6) {
      return res.redirect(post.url + '#comments');
    }
    await ctx.community.add({
      target: 'post:' + post.slug,
      name: req.body.name,
      email: req.body.email,
      url: req.body.url,
      location: req.geoGuess,
      message: req.body.message,
      ip: req.clientIp,
      ua: req.get('user-agent'),
      autoApprove: !ctx.site.features.moderateComments && spam < 3,
    });
    res.redirect(post.url + '#comments');
  });

  /* ---------------------------------------------------------- random */
  router.get('/random', (req, res) => {
    if (!ctx.site.features.randomPost) return res.redirect('/');
    const post = ctx.index.randomPost();
    if (!post) return res.redirect('/');
    res.redirect(post.url);
  });

  return router;
}
