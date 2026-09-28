# oldie-blog

> A 1990s personal homepage that survived the dot-com winter.
> Markdown in, server-rendered HTML out, webrings, guestbooks, a DOS terminal
> in the corner — and a real SEO layer underneath.

[![node](https://img.shields.io/badge/node-%3E%3D22.13-3fa633?logo=node.js)](https://nodejs.org)

English · [简体中文](./README.zh-CN.md)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![deps](https://img.shields.io/badge/dependencies-6-informational)](#why-so-few-dependencies)

```bash
nvm use            # Node 24 recommended (.nvmrc is committed)
pnpm install
pnpm start         # → http://localhost:4173
```

The first boot prints a temporary admin password. Sign in at `/admin`, change
it under **Settings → Password**, and delete `config/admin.json` if you ever
need a fresh one.

---

## What this is

A blog that looks like it was last touched in 1998 and behaves like it was
deployed yesterday:

- **Blog pages** — home, post, page, archive by year, tags, tag, search,
  guestbook, 404, plus one Markdown file per route in `content/`.
- **Admin backend** — login, dashboard, post/page editor with live preview,
  drafts, duplication, guestbook moderation, media uploads, settings,
  SEO checklist and a full JSON export.
- **Markdown authoring** — files in `content/posts/*.md` are the source of
  truth. The admin writes the same files you would edit by hand, so your
  content survives any migration, forever.
- **SEO done properly** — canonical URLs, Open Graph/Twitter cards, JSON-LD
  (`BlogPosting`, `WebSite` + `SearchAction`, `BreadcrumbList`), RSS 2.0,
  Atom 1.0, JSON Feed 1.1, `sitemap.xml`, `robots.txt`, `llms.txt`, a web
  manifest, pagination `rel=prev/next`, gzip, ETag and honest cache headers.
- **Signature features** — the fun stuff, listed below.

---

## Signature features

| | Feature | What it does |
| --- | --- | --- |
| ⌨️ | **DOS terminal** | `Ctrl`+`K` opens a green-on-black prompt on every page. `dir`, `type <slug>`, `search`, `stats`, `neofetch`, `fortune`, `guestbook` — all answered by the real server, so nothing is faked. |
| 🎵 | **Chiptune theme** | Square waves and noise hats generated live with the Web Audio API. Zero bytes of audio, never autoplays, remembers your choice. |
| 📻 | **Radio narration** | "Listen to this post" reads the article aloud with `speechSynthesis`, complete with a blinking VU meter. |
| 📊 | **Hit counter** | Odometer digits, today/unique/live-online counts, per-path stats and a 30-day sparkline in the admin. Starts at 1998. |
| 🌐 | **Webring** | Prev / next / random navigation through a configurable list of neighbour sites. |
| 📼 | **.TXT downloads** | Every post has a `POST-XXXX.TXT` button — plain text, exactly how people shared writing in 1998. |
| 📬 | **Guestbook + comments** | Moderation queue, honeypot, link/keyword spam scoring, per-post comments. |
| ⏳ | **Time Machine** | One click flips the site into 1998 mode: Times New Roman, centred layout, navy desktop, no JavaScript chrome. Shareable with `?theme=1998`. |
| 🎲 | **Random post** | Deterministic per day, so "random" stays reproducible. |
| 🗺 | **`.json` per post** | Machine-readable Markdown/HTML/text for every article. |
| 🌐 | **Language switch** | Chinese by default, English in one click. `?lang=en` is shareable, `hreflang` tells search engines, and the choice is remembered in one cookie. |

Plus: a 56k dial-up progress bar, scrolling marquee, blinking status line,
"best viewed in Netscape 4.0" banner, and a status bar that reports the real
server time.

---

## Writing a post

Create `content/posts/2025-06-01-my-post.md`:

```markdown
---
title: "My post title"
date: 2025-06-01
updated: 2025-06-04        # optional, shows "updated" + feeds
description: "Shown in listings, meta tags and the RSS summary."
tags: [markdown, web-design]
featured: false             # pins to the home page
draft: false
cover: /uploads/cover.png
coverAlt: "A beige CRT monitor"
keywords: [extra, seo, terms]
canonical: ""               # for syndicated / moved posts
noindex: false
---

The body is Markdown — plus raw HTML, because this is a 1990s blog and
<blink>some things are better left alone</blink>.

<!-- more -->                # everything above is the teaser

## Headings get anchors

Code fences are highlighted, ```ascii``` blocks render in a pixel font,
==highlight== works, and ++ctrl+k++ becomes real <kbd> keys.
```

Filenames may start with `YYYY-MM-DD-`; the date and slug are taken from it
automatically. Anything in `content/pages/` is served at `/<slug>`.

Quick start from a terminal:

```bash
pnpm new:post "My post title" --tags=retro,web --draft
```

### Front matter reference

| Key | Type | Notes |
| --- | --- | --- |
| `title` | string | Required. Used in `<title>`, RSS and JSON-LD. |
| `date` | date | Defaults to the filename prefix, then the file mtime. |
| `updated` | date | Optional. Feeds and `article:modified_time`. |
| `description` | string | Falls back to the auto-generated excerpt. |
| `tags` | list | Drives `/tags`, tag feeds and related posts. |
| `draft` | bool | Hidden from visitors, visible in the admin. |
| `featured` | bool | Pinned to the home page. |
| `cover` / `coverAlt` | path / string | Hero image and its alt text. |
| `keywords` | list | Extra meta keywords. |
| `canonical` | url | For posts published elsewhere first. |
| `noindex` | bool | Keep it out of search engines. |

---

## The admin

| Screen | What it is for |
| --- | --- |
| **Dashboard** | Hits, words, drafts, 30-day chart, moderation queue, top paths, SEO health. |
| **Posts / Pages** | Filter, edit, duplicate (as a draft), delete. |
| **Editor** | Live preview (HTML / meta / raw Markdown), toolbar, slug auto-fill, description auto-excerpt, local autosave, image insertion. |
| **Guestbook** | Approve, mark spam, delete; e-mails and IPs never leak to the public page. |
| **Media** | Upload images (or paste a data URL); 4 MB limit, image MIME types only. |
| **Settings** | Title, description, nav, webring, banners, appearance, analytics snippet, password. |
| **Tools** | SEO checklist, raw Markdown viewer, subscriber list, full JSON export. |

Saving in the admin writes a normal `.md` file to `content/` — check
`git status` and you will see exactly what changed.

---

## Where the admin lives

Public pages are public. The admin is a door you choose:

```json
// config/site.config.json
{ "adminPath": "/my-secret-door" }
```

`admin`, `/admin`, `/my-secret-door/` all work — the value is normalised,
sanitised, and can never climb out of the site root. Everything (login, editor,
media, tools, redirects, navigation) moves with it, and `GET /healthz` reports
the current value so you never have to guess.

The public site never links to it, the sitemap never lists it, and robots.txt
deliberately does **not** name it: putting a secret door in robots.txt is an
invitation, not a lock. Admin pages also send `X-Robots-Tag: noindex, nofollow`
and `X-Frame-Options: DENY`.

---

## Speed

Cold load measured in a headless browser: **~300 ms**, server response **5–20 ms**.

- **Fixed a real 6-second stall.** The hand-rolled gzip middleware handed
  `undefined` back to Node's `res.end()` on the "too small to compress" path
  after intercepting `write()`, which left the socket waiting. Small assets (the
  syntax theme, the favicon) paid a full timeout on every single page load.
- **Assets are cached hard.** CSS/JS carry `?v=<hash>`, so they keep a long
  `max-age` even in development instead of re-downloading 58 KB per visit.
- **HTML revalidates.** `Cache-Control: no-cache` plus an ETag turns a repeat
  visit into a few-byte 304 instead of a full page.
- **Hit counting never blocks the response** — it writes to disk in background.
- Paint stays cheap via `contain` on the heavy card/widget bevels.

---

## Internationalisation

The interface ships in **Chinese (zh-CN)** and **English**, switchable from the
title bar or with `?lang=en` on any URL.

Resolution order: `?lang=` → `oldie_lang` cookie → `site.config.json` →
`Accept-Language`. The switcher writes the cookie for a year and every page
emits `<link rel="alternate" hreflang="…">` plus `og:locale:alternate`, so the
two languages never compete with each other in search results.

```bash
# add a third language
# 1. copy an object in src/lib/i18n.js, give it a code + label
# 2. nothing else — templates, routes and the admin pick it up automatically
```

Dates, "N posts", pagination and the whole admin chrome follow the active
language. Your **content** is yours: posts can be written in either language,
and the search index handles CJK (unigram + bigram tokenising).

---

## Configuration

Four layers, later ones win:

1. built-in defaults (`src/lib/config.js`)
2. `config/site.config.json` — the file you commit
3. `data/settings.json` — written by the admin UI (gitignored)
4. environment variables — `SITE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET`

Runtime state also lives in `data/` and is gitignored: hit counter,
guestbook + comments, subscribers, sessions.

---

## Project layout

```
oldie-blog/
├─ bin/oldie-blog.js        CLI entry point
├─ config/
│  ├─ site.config.json      committed site configuration
│  └─ admin.json            scrypt password hash (generated, gitignored)
├─ content/
│  ├─ posts/*.md            your writing
│  └─ pages/*.md            about, colophon, links…
├─ data/                    hit counter, guestbook, subscribers (gitignored)
├─ public/
│  ├─ css/site.css          the 1990s design system
│  ├─ css/admin.css         the control panel
│  ├─ js/site.js            terminal, chiptune, radio, search, theme
│  ├─ js/admin.js           live preview, autosave, slug helpers
│  └─ assets/               generated SVG favicon, logo, OG image
├─ scripts/
│  ├─ smoke-test.js         end-to-end HTTP test (44 checks)
│  ├─ new-post.js           scaffold a post from the terminal
│  └─ seed-demo.js          demo hit counter + guestbook
├─ src/
│  ├─ server.js             express app, middleware, error pages
│  ├─ context.js            wires config + content + stores
│  ├─ lib/                  config, markdown, posts, search, seo, feeds,
│  │                        stats, community, auth, sessions, writer,
│  │                        terminal, http, text, store, paths
│  ├─ routes/               site.js · admin.js · api.js · meta.js
│  └─ views/                EJS templates (public + admin)
└─ tests/                   node:test unit suites
```

---

## Why so few dependencies

Six runtime packages: `express`, `ejs`, `markdown-it`, `highlight.js`,
`gray-matter`, `multer`. Everything else — search, the hit counter, the
guestbook, sessions, CSRF, password hashing, gzip, the chiptune player, the
terminal, the OG image — is in this repository. No native modules, so
`pnpm install` never fights a compiler, and the whole thing runs on a
raspberry pi in a cupboard.

---

## Testing

```bash
pnpm test        # unit suites (73) + end-to-end smoke test (44 checks)
pnpm test:unit   # pure functions only
pnpm test:e2e    # boots the server, drives every route and the admin flow
```

The smoke test creates and deletes its own posts, signs the guestbook,
moderates an entry, uploads an image, rotates the password and logs out — so
you can trust the admin actually works.

---

## Deploying

```bash
git clone https://github.com/you/oldie-blog && cd oldie-blog
pnpm install --prod
SITE_URL=https://your-site.tld ADMIN_PASSWORD=… NODE_ENV=production \
  node src/server.js
```

Behind nginx or Caddy, forward `X-Forwarded-For` (already trusted) and set
`SITE_URL` so canonical URLs, feeds and the sitemap are absolute. The only
writable directory is `data/` (and `public/uploads/` if you use uploads).

---

## Accessibility & the modern web

It is a nostalgia piece, but it is not a badly built one:

- semantic landmarks, skip link, visible focus rings, `aria-`live` log for the terminal
- `prefers-reduced-motion` disables marquees, blinking and the VU meter
- works with JavaScript disabled — every feature except the terminal, music,
  radio and live search degrades to a plain page
- contrast, alt-text reminders in the editor and an SEO check that flags
  missing image descriptions
- one anonymous cookie for the visitor counter, one session cookie for the
  admin. No trackers, ever.

---

## License

MIT — see [LICENSE](LICENSE). Fork it, make it your homepage, put your own
name on it. That is the entire point of personal homepages.
