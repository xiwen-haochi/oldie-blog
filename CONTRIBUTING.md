# Contributing

Thanks for wanting to make a 1998 homepage with us.

## Getting set up

```bash
nvm use
pnpm install
pnpm start
```

Node 22.13+ (24 recommended, see `.nvmrc`). pnpm 10+.

## Before you open a pull request

```bash
pnpm test        # unit suites + end-to-end smoke test
```

Both must be green. The smoke test boots a real server and drives the admin,
so if it passes, your change did not quietly break writing a post.

## House rules

- **Content is Markdown.** Never store a post anywhere else. The admin writes
  `content/posts/*.md`; your editor and `git diff` stay authoritative.
- **No new runtime dependencies** without a good reason. The whole point is
  that this installs in two seconds with no compiler. A one-paragraph
  justification in the PR is fine; "it is convenient" is not.
- **Everything works without JavaScript.** Progressive enhancement only: the
  terminal, music, radio and instant search may be JS, but the post, the
  archive, the guestbook and the search results must render server-side.
- **Retro but not broken.** 1998 aesthetics are the point — WCAG-minded
  markup, real focus states and `prefers-reduced-motion` support are also the
  point. Do not "simplify" an accessibility affordance.
- **Bump the hit counter honestly.** Bots are filtered; please do not add
  endpoints that inflate it.

## Style

- ES modules, 2-space indent, single quotes, no semicolon-free style.
- Comments explain *why*, not *what*.
- Keep view templates dumb: logic belongs in `src/lib/` or the route.
- New public routes need: a page description, a breadcrumb, and an entry in
  the sitemap (usually automatic).

## Reporting bugs

Include the URL, what you expected, what happened, and `node -v`. If it is
visual, a screenshot at 800×600 helps more than you think — that is the
layout this site is imitating.

## Security issues

Do not open a public issue. Email the maintainer; a fix and credit will ship
before disclosure.
