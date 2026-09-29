<div align="center">

![home](docs/home.png)

**oldie-blog** — a personal blog engine with a 1990s interface.

Write in Markdown, rendered on the server, with an admin, full-text search
and a complete SEO layer.

[English](README.md) · [简体中文](README.zh-CN.md)

[![node](https://img.shields.io/badge/node-%3E%3D22.13-3fa633?logo=node.js)](https://nodejs.org)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![deps](https://img.shields.io/badge/runtime%20deps-6-informational)
![tests](https://img.shields.io/badge/tests-206%20unit%20%2B%2077%20e2e-success)

</div>

---

## What it is

A single-process Node blog program. Posts, pages, settings, the guestbook, the
hit counter and every session live in one file, `data/oldie.sqlite`. Six runtime
dependencies, no build step.

The interface is a 1990s personal homepage — webrings, a guestbook, a hit counter,
a DOS terminal on every page, and a mode that switches the whole site back to 1998.
The pages themselves are ordinary server-rendered HTML: no hydration, no frontend
framework, no toolchain.

| | |
| --- | --- |
| ![posts](docs/posts.png) | ![post](docs/post.png) |
| The post list | A post |

### The admin

| | |
| --- | --- |
| ![dashboard](docs/admin-dashboard.png) | ![editor](docs/admin-editor.png) |
| Dashboard: traffic, SEO self-check, moderation queue | Editor: write on the left, preview on the right |

| | |
| --- | --- |
| ![settings](docs/admin-settings.png) | ![media](docs/admin-media.png) |
| Settings: feature switches, storage, site details | Media library: uploaded images |

| | |
| --- | --- |
| ![backup](docs/admin-backup.png) | ![login](docs/admin-login.png) |
| Backup: the whole site as one `.zip` | The admin path is yours to choose |

### Other pages

| | |
| --- | --- |
| ![guestbook](docs/guestbook.png) | ![search](docs/search.png) |
| Guestbook: sign it, with moderation | Search: understands Chinese, understands `tag:` |

| ![1998 mode](docs/mode-1998.png) | ![about](docs/about.png) |
| 1998 mode | The about page |

---

## Quick start

```bash
git clone git@github.com:xiwen-haochi/oldie-blog.git
cd oldie-blog

nvm use            # Node 24 recommended (.nvmrc is committed)
pnpm install
pnpm start         # → http://localhost:4173
```

The first boot prints a temporary admin password. Sign in at `/admin` and change
it under **Settings → Password**.

Want something to look at first?

```bash
pnpm seed          # five sample posts, a guestbook, a counter
```

---

## Deploying

### Docker

```bash
cp .env.example .env      # set ADMIN_PASSWORD and SITE_URL
docker compose up -d
```

Your writing, your counters and your settings live in named volumes, so rebuilding
the image never loses them. `/healthz` backs the container healthcheck.

### Built from GitHub

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

### The admin password

**On the first boot** the app does one of two things:

- `ADMIN_PASSWORD` is set in the environment → it uses that, **for that boot only**
- it is not set → one is generated and printed in the startup log:

```
┌─ first run ─────────────────────────────────────────────┐
│ admin user : admin                                     │
│ temp pass  : xxxxxxxxxxxxx                             │
└──────────────────────────────────────────────────────────┘
```

**To read that line:** the service page → the **Console** tab → scroll back to the
first boot.

**To change it:** sign in → **Settings → Password** → current password, then the new one.

Afterwards the `ADMIN_PASSWORD` variable can be deleted — it only seeds the first boot,
and from then on the password you chose is the one that counts, restarts included.

Inside a container (Railway's Console has no shell, so use SSH or run it locally):

```bash
docker compose exec blog node scripts/reset-admin.js   # with compose
docker exec -it <container> node scripts/reset-admin.js # anywhere else
```

The image carries `scripts/`, so resetting the password, adding a post (`new-post.js`)
and seeding demo data (`seed-demo.js`) all work in a running container.
The test suite is not shipped.

### Railway

1. **New Project → Deploy from GitHub repo**, pick `xiwen-haochi/oldie-blog`.
   Railway reads the `Dockerfile` and builds it.

2. **Attach one volume, at `/app/data`.** Railway's filesystem is ephemeral and a
   redeploy clears it; the whole site is in that one file.

   | Mount at | Holds | Without it |
   | --- | --- | --- |
   | `/app/data` | `oldie.sqlite` — settings, every post and page, guestbook, subscribers, sessions | **the next redeploy empties the entire site** |

   `config/` and `content/` do not need one: `site.config.json` is read once on the
   first boot, and any `.md` under `content/` is imported once at the same time.

3. **Set three variables** (the Variables tab):

   | Variable | Value | If you skip it |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | a long password of your own | a random one is printed at boot and changes on every restart |
   | `SESSION_SECRET` | a random string | everybody is logged out after every restart |
   | `SITE_URL` | the domain Railway gives you | canonical links, feeds and the sitemap all point nowhere |

   The port needs no attention: Railway injects `PORT` and the app reads it.

Once it is live Railway hands you a `*.up.railway.app` address. **Settings → Networking**
lets you attach your own domain.

> The free tier sleeps when idle, so a cold start takes a few seconds.

### On a plain server

```bash
git clone … && cd oldie-blog && pnpm install
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

## Writing a post

### In the admin

```
①  open  https://your.site/admin/posts/new

②  title

③  body    — Markdown on the left, live preview on the right
             the toolbar has B / I / heading / quote / link / image / code

④  optional fields on the right
      · tags        comma separated, they become tag pages
      · description  leave blank and it takes the opening of the body;
                     the same text is used for SEO and the feed
      · cover        pick one from the media library, or type /uploads/photo.png

⑤  press Save        → published, live immediately
   tick Draft first  → only you can see it
   tick Pin first    → it sorts above everything else
```

![The editor](docs/admin-editor.png)

**To edit a published post:** **Posts** in the sidebar → click the title → save again.
**To delete one:** the delete button on the same row.

**Images:** drag the file into the body box, or upload it under **Media** and write
`![alt](/uploads/photo.png)`.

**Changed your mind?** the editor autosave only lives in your browser, so closing the
tab discards it. A published post is in the database, and **Backup & restore** writes a
`.zip` of exactly that.

### The command line

```bash
pnpm new:post "My title" --tags=intro,tools --draft
pnpm clean          # wipe posts, pages, messages and counters for a fresh start
```

Both write to the database. There is also `seed-demo.js` if you want sample content.

### Markdown files

Posts live in the database. Two places still touch `.md` files:

- **a backup** writes a real Markdown copy alongside the database, so you can read it
- **a fresh install** imports any `.md` it finds in `content/posts/` and `content/pages/`

The format is:

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

### What a push to GitHub actually does

| | |
| --- | --- |
| Code changes | pushed; CI re-runs the tests and rebuilds the image |
| **Your posts** | **not pushed** |
| **The admin password** | **not pushed** |
| Messages, hits, settings | **not pushed** |

`content/`, `data/`, `config/admin.json` and `public/uploads/` are all in `.gitignore`.
So anyone who clones your repo gets an empty site, and running the same blog on a
second machine means exporting a `.zip` from **Backup & restore** and importing it
there. **git carries the code, a `.zip` carries your content.**

---

## Data and backup

| Path | Holds | Published? |
| --- | --- | --- |
| `data/oldie.sqlite` | posts, pages, settings, messages, hits, sessions | no |
| `config/admin.json` | the admin password (a scrypt hash) | no |
| `public/uploads/` | images you attached | no |
| `content/` | imported on first boot, written by a backup | no |
| `config/site.config.json` | title, nav, webring names | yes, the pages need it |

**Backup** is one click in the admin: it writes a single `.zip` with the database, the
uploads and the config. Restoring puts the previous data aside rather than deleting it,
so a mistake is always reversible.

> A post is a row in a database, not a plain text file you can `git diff`. What you get
> in exchange is one thing to back up and one thing to copy when you move servers.
> If you want the plain text, the backup archive has it.

---

## Features

**Writing** — Markdown with front matter, live preview, drafts, pinning, tags, per-post
SEO fields and a table of contents. Pasted HTML goes through an allowlist: `style`,
inline backgrounds and event handlers are stripped; tables and inline SVG survive.

**Reading** — full-text search that understands Chinese (unigram + bigram), an archive,
tag pages, reading time, and every post downloadable as plain `.txt` or `.json`.

**The 1990s** — webrings with neighbours, a guestbook that needs moderation, a hit
counter, a marquee, blinking text, a DOS terminal on every page
(<kbd>Ctrl</kbd>+<kbd>K</kbd>), a chiptune theme synthesised in the browser, and a mode
that switches the site back to 1998.

**SEO and safety** — RSS / Atom / JSON Feed, `sitemap.xml`, JSON-LD, `llms.txt`,
Open Graph, hreflang alternates. The admin path is configurable and never advertised;
passwords are scrypt hashes, session cookies are signed, forms carry CSRF tokens, login
is rate limited, and every request goes through the HTML sanitiser.

**Switchable** — comments, comment moderation, the guestbook, search, the hit counter,
random posts, the table of contents and reading time each have a switch in the admin.

---

## Development

```bash
pnpm test          # 206 unit tests + 77 end-to-end checks
pnpm test:unit
pnpm test:e2e
pnpm dev           # node --watch
node scripts/check-secrets.mjs
```

Six runtime dependencies: `express`, `ejs`, `markdown-it`, `highlight.js`,
`gray-matter`, `multer`. The search index, sessions, gzip, S3 signing and the ZIP
reader/writer are in `src/lib`. No compiler, no native modules — `pnpm install`
takes seconds on a fresh clone.

The end-to-end suite boots a real server in a throwaway data directory, so it can never
touch your own posts or counters.

---

## Licence

MIT. See [LICENSE](LICENSE).
