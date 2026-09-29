<div align="center">

![home](docs/home.png)

**老博客 / oldie-blog** — a 1990s personal homepage that outlived the dot-com winter.
Markdown in, server-rendered HTML out, webrings, guestbooks, a DOS terminal in the corner,
and a real SEO layer underneath.

[English](README.md) · [简体中文](README.zh-CN.md)

[![node](https://img.shields.io/badge/node-%3E%3D22.13-3fa633?logo=node.js)](https://nodejs.org)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![deps](https://img.shields.io/badge/runtime%20deps-6-informational)](#why-so-few-dependencies)
![tests](https://img.shields.io/badge/tests-149%20unit%20%2B%2060%20e2e-success)

</div>

---

## What it is

A personal blog engine dressed as a 1996 GeoCities page. The nostalgia is the interface;
underneath it is a boring, fast, server-rendered blog: posts are plain Markdown files on
disk, the admin is a real one, and the SEO surface is complete.

| | |
| --- | --- |
| ![posts](docs/posts.png) | ![post](docs/post.png) |
| **The index** — pinned post, then the rest | **A post** — every page is a real `.md` file |

### Admin

| | |
| --- | --- |
| ![dashboard](docs/admin-dashboard.png) | ![editor](docs/admin-editor.png) |
| **Dashboard** — traffic, SEO self-check, moderation queue | **Editor** — Markdown with a live preview |

| | |
| --- | --- |
| ![settings](docs/admin-settings.png) | ![backup](docs/admin-backup.png) |
| **Settings** — feature switches, storage driver, attachments | **Backup** — the whole site as one `.zip` |

### The rest of it

| | |
| --- | --- |
| ![guestbook](docs/guestbook.png) | ![search](docs/search.png) |
| **Guestbook** — sign it, with moderation | **Search** — CJK-aware, `tag:` included |

| ![1998 mode](docs/mode-1998.png) | ![login](docs/admin-login.png) |
| **1998 mode** — one click rewinds the whole site | The admin is never advertised, never indexed |

---

## Quick start

```bash
git clone git@github.com:xiwen-haochi/oldie-blog.git
cd oldie-blog

nvm use            # Node 24 recommended (.nvmrc is committed)
pnpm install
pnpm start         # → http://localhost:4173
```

The first boot prints a temporary admin password. Sign in at `/admin` and change it under
**Settings → Password**.

Want something to look at first?

```bash
pnpm seed          # five sample posts, a guestbook, a counter
```

---

## Deploying

### One command with Docker

```bash
cp .env.example .env      # set ADMIN_PASSWORD and SITE_URL
docker compose up -d
```

Your writing, your counters and your settings live in **named volumes**, so rebuilding
the image never loses them. `/healthz` backs the container healthcheck.

### From GitHub, automatically

Every push to `main` runs the test suite and builds the image into
GitHub Container Registry:

```bash
docker pull ghcr.io/xiwen-haochi/oldie-blog:latest
```

`.github/workflows/ci.yml` also runs `scripts/check-secrets.mjs`, which fails the build
if anything private is ever about to be committed.

> **One thing to do after the first build:** a GitHub package does **not** inherit the
> repository's visibility. Open [Packages](https://github.com/xiwen-haochi/oldie-blog/packages)
> → `oldie-blog` → **Package settings** → **Change visibility** → **Public**.
> Until you do, `docker pull` from outside gets a 401.

### On a plain server

```bash
git clone … && cd oldie-blog && pnpm install --prod=false
NODE_ENV=production ADMIN_PASSWORD='…' SITE_URL='https://your.site' \
  node src/server.js
```

Put it behind nginx or Caddy for TLS. Behind a reverse proxy set `HOST=127.0.0.1` and
let the proxy terminate HTTPS — the app speaks plain HTTP and never redirects on its own.

### Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `SITE_URL` | `http://localhost:4173` | canonical links, feeds, sitemaps |
| `HOST` / `PORT` | `127.0.0.1` / `4173` | interface to bind |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / generated | first-boot credentials |
| `SESSION_SECRET` | generated | signs session cookies; set it to survive restarts |
| `NODE_ENV` | — | `production` turns on long cache headers for static files |

---

## Publishing a post

Three ways to do it. **All three end up writing a `.md` file into `content/posts/`.**

### 1. The admin (what you will use most)

```
1. Open /admin/posts/new
2. Type the title, write Markdown in the body box — the preview is live
3. Optionally set tags and a description (blank means "take the first 140 chars")
4. Press Save to publish, or tick Draft first to keep it private
```

It appears on the home page immediately. Tick **pin to home** to move it up: the
pinned section sorts by **when you pinned it**, so re-pinning an old post lifts it
to the top.

To edit a published post: **Posts** in the admin sidebar → click the title.
To delete one: the delete button on the right of the list.

### 2. From the command line

```bash
pnpm new:post "My title" --tags=intro,tools --draft
```

Creates a file with the front matter already filled in. Drop `--draft` to publish it.

### 3. Any editor, plus git

```bash
vim content/posts/2026-09-29-my-post.md
```

The whole format is this:

```markdown
---
title: "The title"           # required
date: 2026-09-29             # required, decides the order
description: "one line"     # optional, taken from the body if blank
tags: [intro, tools]         # optional, commas work too
featured: true               # optional, pin it
draft: true                  # optional, keep it private
cover: /uploads/x.png        # optional, cover image
---

The body is plain Markdown.
```

**Saving is publishing** — the server watches that directory, so a refresh is all it takes.

### Images

Drag them into the media page, or straight into the body box in the editor.
Anywhere else works too:

```markdown
![alt text](/uploads/photo.png)
```

### When something looks wrong

| Symptom | Cause |
| --- | --- |
| Saved but the page did not change | is it a `.md` file, is it in `content/posts/` |
| Missing from the list | check for `draft: true` |
| The URL of a Chinese title is ugly | set the Slug field in the editor |
| Want to undo | the posts are files: `git checkout content/posts/` |

## Your writing is data, not code

This is the part most blog engines get wrong. Here:

- posts are `content/posts/*.md` — edit them in your editor, in git, anywhere
- `content/`, `data/` and `config/admin.json` are **gitignored** and never published
- a fresh clone starts empty; `pnpm seed` gives you sample content to look at

```bash
pnpm new:post "Hello world" --tags=intro --draft
pnpm clean          # wipe posts, pages, messages and counters for a fresh start
```

### Where everything lives

| Path | Holds | Published? |
| --- | --- | --- |
| `content/posts/*.md` | your posts | no — that is yours |
| `content/pages/*.md` | standalone pages | no |
| `data/` | hit counter, guestbook, subscribers, sessions, settings | no |
| `config/admin.json` | the admin password (scrypt) | no |
| `config/site.config.json` | title, nav, webring names | **yes**, on purpose |
| `public/uploads/` | images you attached | no |

**Backup** is one click in the admin: it writes a single `.zip` with your content,
uploads, config and runtime data. Restoring puts the previous files aside rather than
deleting them, so a mistake is always reversible.

---

## Features

**Writing** — Markdown with front matter, live preview, drafts, pinning, tags,
per-post SEO, and a table of contents. Paste raw HTML and it is sanitised, not trusted:
stylesheets, inline backgrounds and event handlers are stripped, tables and inline SVG survive.

**Reading** — full-text search that understands Chinese (unigram + bigram), an archive,
tag pages, reading time, and every post downloadable as plain `.txt` or `.json`.

**The 1990s** — webrings with neighbours, a guestbook that needs moderation, a hit counter,
a marquee, blinking text, a DOS terminal on every page (<kbd>Ctrl</kbd>+<kbd>K</kbd>),
a chiptune theme synthesised in the browser, and a **1998 mode** that rewinds the whole site.

**The real parts** — RSS/Atom/JSON Feed, `sitemap.xml`, JSON-LD, `llms.txt`, Open Graph,
hreflang alternates, an admin at a configurable path that is never advertised, scrypt
passwords, signed sessions, CSRF tokens, rate-limited login, and a per-request HTML sanitiser.

**Switchable** — comments, comment moderation, the guestbook, search, the hit counter,
random posts, the table of contents and reading time each have an off switch in the admin.

---

## Why so few dependencies

Six runtime packages: `express`, `ejs`, `markdown-it`, `highlight.js`, `gray-matter`,
`multer`. Everything else is in `src/lib`:

| Instead of | this repo has |
| --- | --- |
| a search library | a CJK-aware inverted index, ~200 lines |
| a session library | HMAC-signed cookies, ~80 lines |
| `bcrypt` | `node:crypto` `scrypt` |
| a compression library | a hand-rolled gzip middleware |
| a template engine beyond EJS | EJS, plus a small view layer |
| an S3 SDK | a SigV4 signer over `fetch` |
| a ZIP library | a deflate/store writer and reader |
| a markdown sanitizer | an allowlist HTML sanitiser |

No compiler, no `node-gyp`, no lockfile rot on a fresh clone. `pnpm install` takes seconds.

---

## Development

```bash
pnpm test          # 149 unit tests + a 60-check end-to-end suite against a real server
pnpm test:unit
pnpm test:e2e
pnpm dev           # node --watch
node scripts/check-secrets.mjs
```

The end-to-end suite boots a real server in a throwaway data directory, so it can never
touch your own posts or counters.

---

## Licence

MIT. See [LICENSE](LICENSE).
