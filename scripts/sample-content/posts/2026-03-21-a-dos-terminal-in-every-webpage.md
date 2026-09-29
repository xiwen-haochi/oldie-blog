---
title: "A DOS terminal in every webpage"
date: 2026-03-21
description: "Ctrl+K, type help, and the whole site answers. The most unnecessary and most fun feature on this blog."
tags: [code, retro, javascript]
featured: false
---

The single best thing about 1990s personal pages is that they let you *play*.
Webrings, guestbooks, MIDI files, spinning badges — none of it was necessary.

<!-- more -->

## Ctrl+K

Press <kbd>Ctrl</kbd>+<kbd>K</kbd> on any page and a green-on-black prompt appears. It talks to a
small command engine on the server, so the output is never faked:

```ascii
C:\OLDIE> stats
SITE STATISTICS
  total hits ....... 19981
  posts ............ 4 (1 draft)
  words written .... 3120
  uptime ........... 3d 4h 12m 8s

C:\OLDIE> dir posts
  SIZE  DATE        NAME
  ----------------------------------------------------------
  5210  2025-04-02  chiptune-theme-without-a-single-mp3
  3102  2025-03-21  a-dos-terminal-in-every-webpage
  2870  2025-02-03  writing-in-markdown-in-the-year-of-the-terminal
  1980  2025-01-12  welcome-to-my-homepage
```

## The commands

- `dir` / `ls` — list what is on the disk
- `type <slug>` — print a post as plain text, in a terminal
- `search <query>` — the same index the web search uses, with `tag:` and `"phrases"`
- `neofetch` — the obligatory system info banner
- `fortune` — a saying from the archives
- `guestbook` — read other people's messages without leaving the prompt

Everything except `clear`, `exit`, `music` and `theme` is handled by the
server, so you can even `curl -d cmd=stats /api/terminal` if you are the
type of person who does that.

## Why build it?

Because a search box is a *feature* and a terminal is a **personality**. It says
the person who made this site thinks the web is fun. That was always the point.
