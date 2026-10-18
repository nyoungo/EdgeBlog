-- ============================================================================
-- Edge Blog — seed data
-- Apply AFTER migrations 0001 + 0002.
--
-- Default admin credentials:
--     username: admin
--     password: admin12345        <-- CHANGE IMMEDIATELY after first login
-- The hash below is PBKDF2-SHA256, 100000 iterations, 16-byte salt, 32-byte key.
-- Generate a new one with:  npm run hash-password -- "your-new-password"
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Admin user
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role)
VALUES (
  1,
  'admin',
  '站长',
  'pbkdf2$sha256$100000$7JLZTZlF8PGGrR8OIj10MQ==$7h5ZZqKw78X74klSabwLqz5Qt/OzbepItyy4Ji8GKOI=',
  'admin'
);

-- ---------------------------------------------------------------------------
-- Settings — the customization model. One row per namespace.
-- These values are the site defaults; the admin Appearance panel patches them.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO settings (key, value_json) VALUES
('site', json('{
  "name": "Edge Blog",
  "tagline": "在边缘写作，与世界相连",
  "description": "一个部署在 Cloudflare Pages 上的现代化动态博客，React + Hono + D1。",
  "logo": { "type": "text", "text": "Edge", "imageUrl": "" },
  "favicon": "",
  "footerText": "© 2026 Edge Blog. 保留所有权利。",
  "footerLinks": [
    { "label": "RSS", "href": "/rss.xml" },
    { "label": "Sitemap", "href": "/sitemap.xml" }
  ],
  "locale": "zh-CN"
}')),

('theme', json('{
  "preset": "ink",
  "mode": "system",
  "primaryColor": "",
  "backgroundColor": "#f5f7ff",
  "fontBody": "sans",
  "fontHeading": "sans",
  "fontScale": "md",
  "radius": "md",
  "maxWidth": "72ch",
  "lineHeight": "relaxed",
  "codeTheme": "github-dark"
}')),

('layout', json('{
  "homeModules": [
    { "id": "hero",       "enabled": true },
    { "id": "latest",     "enabled": true },
    { "id": "featured",   "enabled": true },
    { "id": "tags",       "enabled": true },
    { "id": "newsletter", "enabled": false }
  ],
  "sidebar": "right",
  "cardStyle": "magazine",
  "cardSize": "md",
  "cardBlur": "none",
  "postsPerPage": 9,
  "hero": {
    "width": "contained",
    "height": "",
    "fullScreen": false,
    "background": "",
    "backgroundImage": "",
    "overlayLight": 0,
    "overlayDark": 0,
    "textColor": "",
    "textMutedColor": "",
    "align": "left"
  },
  "header": {
    "position": "sticky",
    "style": "default",
    "background": "glass",
    "transparentOnTop": true,
    "height": "64px",
    "align": "center"
  }
}')),

('navigation', json('[
  { "id": "nav-home",    "label": "首页", "href": "/",        "external": false, "newTab": false },
  { "id": "nav-posts",   "label": "文章", "href": "/posts",   "external": false, "newTab": false },
  { "id": "nav-archive", "label": "归档", "href": "/archive", "external": false, "newTab": false },
  { "id": "nav-tags",    "label": "标签", "href": "/tags",    "external": false, "newTab": false },
  { "id": "nav-about",   "label": "关于", "href": "/about",   "external": false, "newTab": false }
]')),

('social', json('[
  { "id": "soc-github", "type": "github", "label": "GitHub", "url": "https://github.com" },
  { "id": "soc-x",      "type": "x",      "label": "X",      "url": "https://x.com" },
  { "id": "soc-email",  "type": "email",  "label": "邮箱",   "url": "mailto:hello@example.com" },
  { "id": "soc-rss",    "type": "rss",    "label": "RSS",    "url": "/rss.xml" }
]')),

('features', json('{
  "comments": true,
  "search": true,
  "rss": true,
  "views": true,
  "viewTransitions": true,
  "toc": true,
  "backToTop": true,
  "newsletter": false,
  "relatedPosts": true,
  "prevNext": true
}')),

('advanced', json('{
  "customCss": "",
  "headHtml": "",
  "footerHtml": "",
  "analytics": { "provider": "none", "token": "" }
}')),

('pages', json('{
  "about": {
    "title": "关于本站",
    "contentMd": "## 你好，世界 👋\n\n这里是一个运行在 Cloudflare 边缘网络上的动态博客。\n\n- **前端**：React + TypeScript + Vite + TailwindCSS\n- **后端**：Cloudflare Pages Functions（Hono）\n- **数据**：D1（SQLite）+ R2（对象存储）+ KV（缓存）\n\n全站外观、布局、导航与功能开关都可以在后台的「外观设置」中可视化调整，无需改动代码。\n\n### 联系方式\n\n欢迎通过页脚的社交链接与我联系。",
    "updatedAt": "2026-01-01 00:00:00"
  }
}')),

-- Comment policy knobs, editable from the admin panel.
('comments', json('{
  "requireModeration": true,
  "allowGuests": true,
  "maxDepth": 3,
  "rateLimitSeconds": 30,
  "minLength": 2,
  "maxLength": 2000
}')),

-- Music player (XF Music Player). Disabled by default; enable in the admin panel.
('music', json('{
  "enabled": false,
  "language": "zh",
  "mode": "cloud",
  "apiUrl": "https://music.api.xfyun.club/api/v1/music/top?platform=netease&topId=3778678",
  "playlist": [],
  "theme": "auto-theme",
  "playerWidth": "324px",
  "bottom": "28px",
  "songListHeight": "350px",
  "visibleSongListCount": 4,
  "volume": 0.8,
  "playMode": "order",
  "isAutoPopup": false,
  "isAutoPlaylist": false,
  "colorfulLyric": false,
  "audioVisualizer": false,
  "rememberPlayback": true
}')),

-- AI helper (admin-only namespace; the API key is never exposed publicly).
('ai', json('{
  "enabled": false,
  "provider": "openai",
  "baseUrl": "",
  "apiKey": "",
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "maxTokens": 2048,
  "excerptPrompt": "你是资深的博客编辑。根据用户提供的文章内容，撰写一段 80–120 字的中文摘要：准确概括主旨与关键信息，语气自然，只输出摘要本身，不要标题、不要前后缀、不要引号。",
  "contentPrompt": "你是一位专业的中文博客作者。根据用户提供的标题与要点，写一篇结构清晰、可读性高的 Markdown 文章：使用多级标题、列表与必要的代码块，语言自然、专业，只输出文章正文，不要任何与内容无关的说明。"
}'));

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO tags (id, name, slug) VALUES
  (1, 'Cloudflare', 'cloudflare'),
  (2, 'React',      'react'),
  (3, 'TypeScript', 'typescript'),
  (4, '设计',        'design'),
  (5, '随笔',        'essay');

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO posts
  (id, slug, title, excerpt, content_md, cover_url, status, published_at,
   meta_title, meta_description, word_count, featured, views, author_id, created_at, updated_at)
VALUES
(
  1,
  'hello-edge-blog',
  '从零搭建边缘博客：技术选型与取舍',
  '为什么选择 Cloudflare Pages 全家桶？本文记录这套可定制动态博客的架构决策、数据模型与渲染策略。',
  '## 为什么要做这个项目

静态博客很好，但一旦需要「后台实时编辑、评论审核、全站可视化定制」，静态生成就开始拧巴。于是有了这个项目：**内容与配置全部存在服务端，页面依然是 SPA**。

## 技术选型

| 层 | 选型 | 原因 |
| --- | --- | --- |
| 前端 | React + Vite | 生态成熟，HMR 快 |
| 路由 | React Router | 声明式，支持 data router |
| 样式 | Tailwind + CSS 变量 | 原子类保证一致，变量驱动换肤 |
| 后端 | Hono on Pages Functions | 极小、Web 标准、TS 友好 |
| 数据 | D1 (SQLite) | 边缘复制，SQL 直观 |
| 存储 | R2 | 零出口费，图片友好 |

## 一个关键决策：渲染在哪一层

Markdown 的 HTML 渲染放在**浏览器端**，而不是 Worker。原因是 XSS 净化：

```ts
import { marked } from "marked";
import DOMPurify from "dompurify";

const html = DOMPurify.sanitize(marked.parse(md));
```

DOMPurify 依赖真实的 DOM，在 Workers 里没有 `window`。把渲染 + 净化都放到浏览器，既避免了在边缘拼一个 DOM shim，也让净化更难被绕过。SEO 需要的 `title/description/og` 由 Pages Function 在 HTML 外壳里注入，爬虫拿得到。

## 数据模型速览

- `posts` 存正文 Markdown 与 SEO 覆盖字段
- `posts_fts` 是 FTS5 虚表，用 `trigram` 分词器以支持中文子串搜索
- `settings` 以命名空间为单位存 JSON，是整个定制系统的单一事实来源

> 边缘部署的意义不是「快」本身，而是把复杂度从运维里拿掉。

到这里，地基就打好了。',
  NULL, 'published', '2026-01-02 08:00:00',
  '从零搭建边缘博客：技术选型与取舍',
  'Cloudflare Pages 动态博客的架构决策：React + Hono + D1 + R2，以及为什么 Markdown 渲染放在浏览器端。',
  420, 1, 128, 1, '2026-01-02 08:00:00', '2026-01-02 08:00:00'
),
(
  2,
  'd1-sqlite-patterns',
  'D1 使用心得：没有事务时怎么保证一致性',
  'D1 是 SQLite，但不是完整 SQLite。聊聊批处理、FTS5 与幂等写入的实践。',
  '## D1 的现实

D1 基于 SQLite，但**不支持交互式事务**（`BEGIN ... COMMIT`）。这会影响很多习惯写法。

### 用 batch 代替事务

`db.batch([...])` 会在一个隐式事务里执行一组语句：

```ts
await env.DB.batch([
  db.prepare("INSERT INTO posts (slug, title) VALUES (?, ?)").bind(slug, title),
  db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES (last_insert_rowid(), ?)").bind(tagId),
]);
```

只要其中一条失败，整批回滚。这是 D1 里最接近事务的东西。

### 全文搜索用 FTS5

不要用 `LIKE %keyword%` 扫全表。建一张 FTS5 虚表：

```sql
CREATE VIRTUAL TABLE posts_fts USING fts5(
  title, excerpt, content_md,
  content = ''posts'', content_rowid = ''id'',
  tokenize = ''trigram''
);
```

`trigram` 分词器对中文尤其重要 —— 默认的 `unicode61` 会把一整段中文当成一个词，子串搜索必然失败。

### 幂等写入

部署脚本、Webhook 都可能重放。给关键写入加 `INSERT OR IGNORE` 或唯一索引，重放不会产生脏数据。

## 小结

- 用 `batch` 表达原子性
- 用 FTS5 表达搜索
- 用唯一约束表达幂等',
  NULL, 'published', '2026-01-04 09:30:00',
  'D1 使用心得：没有事务时如何保证一致性',
  'Cloudflare D1 的 batch、FTS5 trigram 分词与幂等写入的工程实践。',
  320, 0, 96, 1, '2026-01-04 09:30:00', '2026-01-04 09:30:00'
),
(
  3,
  'design-tokens-theming',
  '用设计令牌驱动主题：一套变量，无限皮肤',
  '把颜色、间距、圆角抽象成 CSS 变量，配合 data-theme 属性，实现零刷新换肤。',
  '## 问题

如果每个组件都写死颜色，换肤就变成了全量搜索替换。我们想要的是：**改一处变量，全站变色，且不刷新页面**。

## 令牌分层

设计令牌分三层，职责清晰：

1. **原始令牌（primitive）**：`--indigo-500: 99 102 241;`
2. **语义令牌（semantic）**：`--c-brand: var(--indigo-500);`
3. **组件令牌**：直接消费语义令牌

组件只碰语义令牌，皮肤只重写语义令牌。

```css
:root {
  --c-bg: 255 255 255;
  --c-fg: 17 24 39;
  --radius: 12px;
}

[data-theme="dark"] {
  --c-bg: 10 10 10;
  --c-fg: 237 237 240;
}
```

注意值用**空格分隔的 RGB 通道**，这样 Tailwind 才能用 `rgb(var(--c-bg) / <alpha-value>)` 表达透明度。

## 运行时切换

切换主题只需改 `<html>` 上的属性，浏览器重绘，无需重新打包：

```ts
document.documentElement.dataset.theme = "dark";
```

配合 View Transitions API，还能得到平滑的过渡：

```ts
document.startViewTransition(() => {
  document.documentElement.dataset.theme = next;
});
```

## 落在配置里

这套令牌的取值最终来自 `settings.theme`，后台改一次，前端注入到 `<html style>`，即时生效。',
  NULL, 'published', '2026-01-06 14:15:00',
  '用设计令牌驱动主题：一套变量，无限皮肤',
  'CSS 变量分层、data-theme 切换与 View Transitions，实现零刷新换肤。',
  260, 1, 74, 1, '2026-01-06 14:15:00', '2026-01-06 14:15:00'
),
(
  4,
  'scheduled-post-sample',
  '（草稿）下一篇预告：评论系统的防刷设计',
  '如何用蜜罐、频率限制与内容指纹，在不引入验证码的前提下遏制垃圾评论。',
  '## 预告

本文尚未发布，用于演示 `draft` 与 `scheduled` 状态。',
  NULL, 'draft', NULL,
  NULL, NULL, 20, 0, 0, 1, '2026-01-07 10:00:00', '2026-01-07 10:00:00'
);

-- ---------------------------------------------------------------------------
-- Post ↔ Tag
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1), (2, 3),
  (3, 4), (3, 5),
  (4, 1), (4, 2);

-- ---------------------------------------------------------------------------
-- Sample comments (one approved, one pending) to exercise moderation UI
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO comments (id, post_id, parent_id, author, email, content, status, ip_hash, created_at) VALUES
  (1, 1, NULL, '小明', 'ming@example.com', '写得很清楚，尤其是渲染放在浏览器端那段，受教了。', 'approved', 'seed', '2026-01-03 12:00:00'),
  (2, 1, 1,    '站长',  NULL,               '谢谢！DOMPurify 那层确实不能省。',              'approved', 'seed', '2026-01-03 13:20:00'),
  (3, 2, NULL, 'Vector', NULL,             'batch 那段帮我解决了一个 bug，感谢。',          'pending',  'seed', '2026-01-05 08:10:00');

-- ---------------------------------------------------------------------------
-- Media index sample row (no R2 object required; illustrates the shape)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO media (id, key, url, filename, size, mime, width, height, created_at) VALUES
  (1, 'seed/og-cover.png', '/media/seed/og-cover.png', 'og-cover.png', 0, 'image/png', 1200, 630, '2026-01-01 00:00:00');
