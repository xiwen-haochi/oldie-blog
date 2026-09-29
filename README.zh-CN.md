# oldie-blog

> 一个活过 dot-com 寒冬的 1990 年代个人主页。
> Markdown 写内容，服务端渲染出 HTML，webring、留言板、角落里的 DOS 终端，
> 外加一套真正做事的 SEO。

[English](./README.md) · 简体中文

```bash
nvm use            # 建议 Node 24（仓库里已有 .nvmrc）
pnpm install
pnpm start         # → http://localhost:4173
```

第一次启动会在终端里打印一个临时管理员密码。打开 `/admin` 登录后，
到 **Settings → Password** 改掉它；想重来就删掉 `config/admin.json` 再启动。

---

## 它是什么

一个看起来停在 1998 年、行为却像今天部署上去的博客：

- **博客页面** — 首页、文章页、独立页面、按年归档、标签、标签页、搜索、
  留言板、404，外加 `content/` 里一个 Markdown 文件对应一个页面。
- **后台** — 登录、控制台、文章/页面编辑器（带实时预览）、草稿、一键复制、
  留言板审核、图片上传、站点设置、SEO 自检、完整 JSON 导出。
- **用 Markdown 写** — `content/posts/*.md` 就是唯一数据源。后台写出来的
  就是你自己会手改的那种文件，`git diff` 一目了然，内容永远不会被困在某个 CMS 里。
- **SEO** — canonical、Open Graph / Twitter 卡片、JSON-LD（`BlogPosting`、
  带 `SearchAction` 的 `WebSite`、`BreadcrumbList`）、RSS 2.0、Atom 1.0、
  JSON Feed 1.1、`sitemap.xml`、`robots.txt`、`llms.txt`、web manifest、
  分页 `rel=prev/next`、gzip、ETag 和诚实的缓存头。
- **特色功能** — 见下表。

---

---

## 关于「浏览器里的浏览器」

这一版把伪装成桌面软件的部分收掉了：右上角的最小化 / 最大化 / 关闭按钮，
以及 File / Edit / View 那条假菜单栏，全都没了 —— 在浏览器标签页里想关直接关标签，
假按钮只会让人误会。

保留的是**有信息量**的 90 年代零件：标题栏（站点名 + 地址 + 语言切换）、
工具条（RSS / 搜索 / 1998 模式 / 访问量）、滚动跑马灯、访问计数器、
留言板、webring 导航，还有那个可以分享的 **1998 时间机器**（`?theme=1998`）。

---

## 忘记密码了？

```bash
pnpm reset:admin                 # 随机生成一个新密码并打印
pnpm reset:admin "我自己的密码"   # 也可以自己指定
```

它会把 scrypt 哈希写进 `config/admin.json`（不进 git，权限 600），**不用重启**，
下一次登录直接生效。

---

## 特色功能

| | 功能 | 说明 |
| --- | --- | --- |
| ⌨️ | **DOS 终端** | 任意页面按 `Ctrl`+`K` 唤出绿字黑底命令行。`dir`、`type <slug>`、`search`、`stats`、`neofetch`、`fortune`、`guestbook` 都由服务端真实执行，输出不是假的。 |
| 🎵 | **芯片音乐主题** | 用 Web Audio 现场合成的方波和噪声，不下载任何音频文件；不自动播放，会记住你的选择。 |
| 📻 | **电台朗读** | 「LISTEN TO THIS POST」用 `speechSynthesis` 把文章念出来，配一个会跳的 VU 表。 |
| 📊 | **计数器** | 数码管式数字、今日/独立访客/在线人数、路径统计，后台还有 30 天柱状图。初始值 1998。 |
| 🌐 | **Webring** | 上一站 / 下一站 / 随机跳转到邻居站。 |
| 📼 | **.TXT 下载** | 每篇文章都有纯文本下载按钮，就像 1998 年那样分享文章。 |
| 📬 | **留言板 + 评论** | 审核队列、蜜罐反垃圾、链接与关键词评分、文章评论。 |
| ⏳ | **时间机器** | 一键切到 1998 模式：Times New Roman、居中排版、藏青桌面、关掉所有花哨的 JS。 |
| 🎲 | **随机文章** | 按日期取模，同一天所有人看到同一篇。 |
| 🗺 | **每篇一个 `.json`** | Markdown / HTML / 纯文本都有，方便机器阅读。 |
| 🌐 | **语言切换** | 默认中文，一键切英文。`?lang=en` 可分享，搜索引擎通过 `hreflang` 知道两个版本，选择记在一个 cookie 里。 |

另外还有：56k 拨号进度条、滚动跑马灯、闪烁状态行、
「BEST VIEWED IN NETSCAPE 4.0」横幅，以及会报真实服务器耗时的状态栏。

---

## 写一篇文章

新建 `content/posts/2025-06-01-my-post.md`：

```markdown
---
title: "文章标题"
date: 2025-06-01
updated: 2025-06-04        # 可选，RSS 和 meta 里会显示「更新于」
description: "列表摘要、meta 描述、RSS 简介都用它。"
tags: [markdown, web-design]
featured: false             # 置顶到首页
draft: false
cover: /uploads/cover.png
coverAlt: "一台米色 CRT 显示器"
---

正文用 Markdown，也允许直接写 HTML——毕竟这是 1990 年代的博客，
<blink>有些东西就该原封不动</blink>。

<!-- more -->                # 上面这段会作为首页摘要

## 标题会自动带锚点

代码块有高亮，```ascii``` 代码块用像素字体渲染，
==高亮== 可用，++ctrl+k++ 会变成真正的 <kbd> 按键。
```

文件名可以以 `YYYY-MM-DD-` 开头，日期和 slug 会自动识别。
`content/pages/` 里的文件会挂在 `/<slug>` 上。

命令行快速创建：

```bash
pnpm new:post "文章标题" --tags=retro,web --draft
```

### front matter 一览

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 必填，用于 `<title>`、RSS 和 JSON-LD。 |
| `date` | date | 缺省取文件名，其次取文件修改时间。 |
| `updated` | date | 可选，影响 RSS 和 `article:modified_time`。 |
| `description` | string | 缺省自动截取正文生成。 |
| `tags` | list | 决定 `/tags`、标签订阅和相关文章。 |
| `draft` | bool | 对访客隐藏，后台可见。 |
| `featured` | bool | 置顶首页。 |
| `cover` / `coverAlt` | 路径 / 文本 | 头图及其替代文本。 |
| `keywords` | list | 额外的 meta 关键词。 |
| `canonical` | url | 适合先发在别处、再搬过来的文章。 |
| `noindex` | bool | 不让搜索引擎收录。 |

---

## 后台

| 页面 | 作用 |
| --- | --- |
| **Dashboard** | 访问量、字数、草稿、30 天曲线、待审队列、热门路径、SEO 自检。 |
| **Posts / Pages** | 筛选、编辑、复制为草稿、删除。 |
| **Editor** | 实时预览（HTML / Meta / 原始 Markdown）、工具栏、slug 自动生成、描述自动摘要、本地自动存草稿、插图。 |
| **Guestbook** | 通过、标记垃圾、删除；邮箱和 IP 永远不会出现在公开页。 |
| **Media** | 上传图片或直接粘贴 data URL，限制 4 MB 与图片 MIME。 |
| **Settings** | 标题、描述、导航、webring、跑马灯、外观、统计代码、密码。 |
| **Tools** | SEO 清单、原始 Markdown 查看、订阅者列表、完整 JSON 导出。 |

后台保存时写出的就是普通的 `.md` 文件到 `content/`，`git status` 一眼就能看出改了什么。

---

---

## 常见配置（后台 → 设置）

**功能开关**

| 开关 | 说明 |
| --- | --- |
| 允许文章评论 | 关掉后文章页不再显示评论区和评论表单 |
| 评论需要审核 | 打开后新评论先进队列，审核通过才公开 |
| 开启留言板 | 关掉后 `/guestbook` 直接 404，侧栏入口也隐藏 |
| 留言需要审核 | 同上，作用于留言板 |
| 开启站内搜索 | 关掉后 `/search` 404 |
| 显示访问计数器 | 关掉后不再计数，侧栏计数器隐藏 |
| 提供随机文章 | 关掉后 `/random` 跳回首页 |
| 文章显示目录 | 只影响有二级标题的文章 |
| 显示阅读时间 | 隐藏每篇文章的预计阅读时长 |

**附件存储**

默认存本地 `public/uploads/`。也可以改用任何 **S3 兼容**的对象存储：
阿里云 OSS、腾讯云 COS、七牛、Cloudflare R2、MinIO 都可以（它们都提供 S3 兼容接口，
本项目内置了一个极小的 SigV4 签名实现，**没有引入任何新依赖**）。

```json
{ "storage": { "driver": "s3", "s3": {
    "bucket": "my-blog-assets",
    "region": "auto",
    "endpoint": "https://<accountid>.r2.cloudflarestorage.com",
    "accessKeyId": "…",
    "secretAccessKey": "…",
    "prefix": "blog",
    "publicUrl": "https://cdn.example.com",
    "pathStyle": true
} } }
```

勾选「使用 path-style 寻址」是 MinIO / R2 需要的；AWS 用虚拟主机式，通常不勾。
密钥存在 `data/settings.json`（不进 git）。

## 粘贴 HTML

文章支持直接粘贴 HTML（包括从别的文档里复制的表格、图示、内联 SVG、视频标签）。
渲染时有两道处理：

1. **保护**：HTML 块（含空行的 `<div>`）会先从 Markdown 解析里提出来，
   不会被当成段落或代码块 —— 这就是之前「内容直接显示成 code」的原因；
2. **消毒**：按白名单过滤 —— `<style>`、`background`、`on*` 事件、
   `javascript:` 一律去掉；表格、图片、`video`、内联 `svg` 保留。

所以你可以放心粘贴，页面样式不会被带崩。
## 备份与恢复

后台 → 💾 备份与恢复。

**导出**：一个 `.zip` 压缩包，包含

- `MANIFEST.json` —— 备份清单（时间、版本、文件列表）
- `content/posts/*.md`、`content/pages/*.md` —— 文章和页面
- `public/uploads/` —— 上传的图片
- `config/` —— 站点配置和管理员密码
- `data/` —— 访问量、留言板、订阅者、后台设置（含 S3 密钥）

**恢复**：选压缩包 → 输入站点标题确认 → 恢复。

- 旧文件不会立刻删除，而是挪到 `.before-restore-<时间>/`，后悔了还能找回来
- 可以勾选「保留当前的上传图片」
- 恢复完重启服务生效
- 压缩包不是本程序导出的会被拒绝；含 `../` 恶意路径的会被拦下

压缩包用的是 Node 自带的 zlib 写的 ZIP（store + deflate），**零依赖**，
可以直接用系统 `unzip`、Finder、Windows 资源管理器打开。

## 发布到 GitHub 之前

```bash
pnpm clean            # 把我的文章/页面/留言/访问量挪到 content/.backup-<日期>
pnpm clean --force    # 直接删掉，不留备份
```

跑完会给你留一篇《第一篇文章》当模板，其余内容都进了备份目录。
然后手动改这两处身份信息：

- `config/site.config.json` —— 站名、作者、邮箱、副标题、导航、webring 名字（**这个文件是要进仓库的**）
- `content/pages/about.md` —— 关于页

其余全是本地数据，`pnpm clean` 会清空，而且 `.gitignore` 已经保证它们不会进仓库：
访问量、留言板、订阅者、会话、后台设置（含 S3 密钥）、管理员密码。
启动时程序会自己检查一遍：发现敏感文件被 git 跟踪就直接报警。

### 运行时数据可以换 SQLite

**默认就是 SQLite**（Node 自带 `node:sqlite`，不用装任何依赖）；想换回 JSON 就在
「设置 → 运行时数据存储」里选 JSON，重启生效：

- 底层是 Node 自带的 `node:sqlite`（22.5+），**不需要装任何依赖**
- 全部数据在一个 `data/oldie.sqlite`，WAL 模式，断电也不容易坏
- 两种后端接口完全一样，随时切回去

| 存哪 | 内容 | 会进 git 吗 |
| --- | --- | --- |
| `data/*.json` 或 `data/oldie.sqlite` | 访问量、留言、订阅、会话 | ❌ 已忽略 |
| `data/settings.json` | 后台设置（含 S3 密钥） | ❌ 已忽略 |
| `config/admin.json` | 管理员密码（scrypt） | ❌ 已忽略 |
| `config/site.config.json` | 站名、导航等公开信息 | ✅ 应该进 |
| `content/*.md` | 文章和页面 | ✅ 你决定 |

## 后台放在哪里

公开页面人人都能看，后台则是你自己选的一扇门：

```json
// config/site.config.json
{ "adminPath": "/my-secret-door" }
```

`admin`、`/admin`、`/my-secret-door/` 都能写，会被规范化、去脏字符，
而且永远跑不出站点根目录。登录、编辑器、媒体、工具、跳转、左侧导航会一起搬过去；
`GET /healthz` 会告诉你当前路径，不用猜。

公开页面不会链到它，sitemap 不会列出它，robots.txt **故意不写**它 ——
把秘密后门写进 robots.txt 是发请帖，不是上锁。后台页面还会带上
`X-Robots-Tag: noindex, nofollow` 和 `X-Frame-Options: DENY`。

---

## 速度

无头浏览器实测：冷启动约 **300 ms**，服务端响应 **5–20 ms**。

- **修掉了一个真实的 6 秒卡顿**：手写的 gzip 中间件在「太小不值得压缩」
  这条分支上，把 `undefined` 交回 Node 的 `res.end()`，而 `write()` 已被拦截，
  于是 socket 一直等着。小文件（代码高亮主题、favicon）每次加载都赔上整个超时。
- **静态资源强缓存**：CSS/JS 带 `?v=<hash>`，开发环境下也能长缓存，
  不用每次访问都重下 58 KB。
- **HTML 走协商缓存**：`Cache-Control: no-cache` + ETag，回访只要一个几 KB 的 304。
- **计数器不挡响应**：写盘放到后台，不占访客的时间。
- 用 `contain` 隔离卡片和侧栏的立体阴影，减少重绘。

---

## 多语言 / Internationalisation

界面默认 **中文（zh-CN）**，标题栏右上角一键切到 **English**；
任何页面加 `?lang=en` 也会切换，方便分享。

判定顺序：`?lang=` → `oldie_lang` cookie → `config/site.config.json` → `Accept-Language`。
切换后会写一年 cookie，并且每个页面都会输出 `<link rel="alternate" hreflang="…">`
和 `og:locale:alternate`，两种语言不会互相抢收录。

```bash
# 想加第三种语言？
# 1. 在 src/lib/i18n.js 里复制一个对象，给它 code + label
# 2. 其他什么都不用改 —— 模板、路由、后台会自动认出来
```

日期、「N 篇文章」、分页、整个后台都会跟着当前语言走。
**内容**归你自己：中英文都能写，搜索索引对中文做了单字 + 双字切分。

---

## 配置

四层，后者覆盖前者：

1. 内置默认值（`src/lib/config.js`）
2. `config/site.config.json` —— 你会提交到 git 的那份
3. `data/settings.json` —— 后台保存的覆盖项（不进 git）
4. 环境变量 —— `SITE_URL`、`ADMIN_USER`、`ADMIN_PASSWORD`、`SESSION_SECRET`

运行时数据同样在 `data/`（不进 git）：计数器、留言板、订阅者、会话。

---

## 为什么依赖这么少

运行时只有 6 个包：`express`、`ejs`、`markdown-it`、`highlight.js`、
`gray-matter`、`multer`。其余的——搜索、计数器、留言板、会话、CSRF、
密码哈希、gzip、芯片音乐、终端、OG 图——都在这个仓库里。
没有原生模块，`pnpm install` 永远不会跟编译器打架，整套东西塞在
树莓派上也能跑。

---

## 测试

```bash
pnpm test        # 单元测试 73 项 + 端到端冒烟测试 44 项
pnpm test:unit   # 只跑纯函数
pnpm test:e2e    # 真的启动服务器，把每个路由和后台流程跑一遍
```

冒烟测试会自己创建并删除文章、签留言板、审核条目、上传图片、
改密码、登出——所以你可以确信后台是真的能用。

---

## 无障碍与「现代」的部分

这是个怀旧项目，但不是糙项目：

- 语义化地标、跳过导航链接、可见焦点环、终端带 `aria-live`
- `prefers-reduced-motion` 会关掉跑马灯、闪烁和 VU 表
- 关掉 JavaScript 依然可读：除终端、音乐、朗读、即时搜索外，
  文章、归档、留言板和搜索结果全部服务端渲染
- 对比度、编辑器里的 alt 文本提醒、SEO 自检会揪出缺失的图片描述
- 一个匿名访客 cookie，一个后台会话 cookie。永远没有追踪器。

---

## 许可证

MIT，见 [LICENSE](./LICENSE)。尽管 fork，把它变成你自己的主页，
换成你自己的名字。这正是个人主页存在的意义。
