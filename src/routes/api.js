import express from 'express';
import { search, parseQuery } from '../lib/search.js';
import { runCommand } from '../lib/terminal.js';
import { checkCsrf } from '../lib/sessions.js';

export function apiRoutes(ctx) {
  const router = express.Router();

  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').slice(0, 120);
    if (!q) return res.json({ query: '', count: 0, results: [] });
    const results = search(ctx.searchIndex, parseQuery(q), 12);
    res.set('Cache-Control', 'no-store').json({
      query: q,
      count: results.length,
      results: results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        tags: r.tags,
        date: r.date,
        readingTime: r.readingTime,
        snippet: r.snippet,
      })),
    });
  });

  router.get('/posts', (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      count: ctx.index.publishedPosts().length,
      posts: ctx.index.publishedPosts().map((p) => ({
        title: p.title,
        slug: p.slug,
        url: p.url,
        date: p.date,
        tags: p.tags,
        readingTime: p.readingTime,
      })),
    });
  });

  router.post('/terminal', (req, res) => {
    if (!checkCsrf(req, req.body && req.body._csrf)) {
      return res.status(403).json({ error: 'bad csrf token' });
    }
    const lines = runCommand(ctx, (req.body && req.body.cmd) || '', {
      visitorId: req.visitorId,
      geoGuess: req.geoGuess,
      screen: req.body && req.body.screen,
    });
    res.set('Cache-Control', 'no-store').json({ lines });
  });

  router.get('/stats', (req, res) => {
    res.set('Cache-Control', 'no-store').json(ctx.stats.summary());
  });

  return router;
}
