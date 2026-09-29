---
title: "Welcome to my home page (again)"
date: 2026-01-12
updated: 2026-01-18
description: "Why a personal homepage is still worth running, and what is actually on this one."
tags: [meta, web-design, personal]
featured: true
featuredAt: "2026-01-12T09:00:00.000Z"
---

Welcome, stranger. You have reached a page that looks like it was last touched by
someone dialing up on a 56k modem — because it was. The scrollbars are real, the
hit counter is real, and so is the guestbook.

<!-- more -->

## What this place is

It is a blog, but it is also a **home page**: a small corner of the web that
somebody made by hand and keeps up to date. Everything you see is rendered on
the server from a plain Markdown file that lives in a Git repository.

- Posts are `.md` files in `content/posts/`
- The site renders on every request — no build step, no hydration
- There is one JSON file for guestbook entries and one for the hit counter
- Everything is MIT licensed, so fork it and make it yours

## Why bother in 2026

Because a personal site is still the last place on the internet where you can
decide what the reader sees, how it looks, and what it costs to load. This one
loads in a few kilobytes, works with JavaScript disabled, and is readable by
screen readers.

## Things to try

1. Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to open the DOS terminal, then type `help`
2. Hit the ♪ button for the chiptune theme (synthesized live, no downloads)
3. Toggle **1998 MODE** in the title bar for the full table-layout experience
4. Download this post as a [.TXT file](/posts/welcome-to-my-homepage.txt)

```bash
# the whole stack, in one line
pnpm install && pnpm start
```

That is it. No database server, no Docker, no `npm run build:42`.
