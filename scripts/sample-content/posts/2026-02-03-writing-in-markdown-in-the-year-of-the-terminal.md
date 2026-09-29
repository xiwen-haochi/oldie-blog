---
title: "Writing in Markdown in the year of the blinking cursor"
date: 2026-02-03
description: "Plain text files, front matter, and why your blog posts should outlive your CMS."
tags: [markdown, writing, tools]
featured: false
---

Every blogging platform eventually asks you to trust it with your words. This one
asks you to trust a text editor.

<!-- more -->

## The format

A post is a file. At the top there is a small block of metadata called
**front matter**:

```yaml
---
title: "Writing in Markdown in the year of the blinking cursor"
date: 2025-02-03
description: "Plain text files, front matter, and why posts should outlive your CMS."
tags: [markdown, writing, tools]
---
```

Everything below the `---` is Markdown, which is a sentence I never thought
would need defending.

## What you get for free

Because the file lives in Git you get:

| Feature | Free because |
| --- | --- |
| Version history | it is a text file |
| Diffable edits | one author per line |
| Portability | any Markdown renderer works |
| Backups | `cp -r` and a coffee |

## Front matter reference

```yaml
title:        string   # required, used in <title> and RSS
date:         date     # defaults to the filename prefix
updated: 2026-02-03
description:  string   # meta description, RSS summary, card excerpt
tags:         list     # drives /tags and tag feeds
draft:        bool     # hidden from the public, visible in admin
featured:     bool     # pinned to the home page
cover:        path     # og:image + hero image
noindex:       bool     # keep it out of search engines
canonical:    url      # for syndicated / moved posts
```

::: tip
Filenames may start with a date — `2025-02-03-my-slug.md` — and the date and
slug are taken from it automatically.
:::
