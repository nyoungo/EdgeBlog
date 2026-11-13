# Edge Blog

一个运行在 **Cloudflare Workers** 上的动态博客系统。内容与配置全部保存在边缘服务端，后台实时编辑；站点外观、布局、导航、首页模块都可以可视化配置，无需改代码。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

- 在线演示：<https://www.068800.xyz>
- 非静态生成：页面是 SPA，数据通过 Worker 提供的 API 实时读取
- 无需服务器：D1 存数据，R2 存媒体，KV 做缓存与限流
- 定时写作：按排期自动生成整篇文章与封面图，并保存为草稿或直接发布

```
React + TypeScript + Vite  ·  React Router  ·  TailwindCSS + CSS 变量
Hono on Cloudflare Workers ·  D1 (SQLite + FTS5)  ·  R2  ·  KV  ·  Workers AI
JWT + HttpOnly Cookie      ·  PBKDF2-SHA256        ·  DOMPurify
```

## 界面预览

### 前台

| 首页 | 通栏 Hero + 叠图卡片 | 沉浸式全屏 Hero |
| :---: | :---: | :---: |
| [![首页](docs/screenshots/home.jpg)](docs/screenshots/home.jpg) | [![通栏 Hero](docs/screenshots/home-hero-fullwidth.jpg)](docs/screenshots/home-hero-fullwidth.jpg) | [![全屏 Hero](docs/screenshots/home-hero-fullscreen.jpg)](docs/screenshots/home-hero-fullscreen.jpg) |

> 同一套代码的三种排版：首页模块、Hero 宽度与背景、卡片样式均在后台「外观设置」中调整。

### 后台

| 概览 | 站点设置 | AI 设置 |
| :---: | :---: | :---: |
| [![后台概览](docs/screenshots/admin-dashboard.png)](docs/screenshots/admin-dashboard.png) | [![站点设置](docs/screenshots/admin-appearance.png)](docs/screenshots/admin-appearance.png) | [![AI 设置](docs/screenshots/admin-ai.png)](docs/screenshots/admin-ai.png) |

## 功能特性

### 内容

- Markdown 文章，支持草稿、定时发布、回收站（软删除）与彻底删除
- 专栏：可配置多个专栏，文章只能属于博客或某一个专栏，两类内容的列表、标签、归档、RSS 互不干扰
- 标签管理、归档页、相关文章、上一篇 / 下一篇
- 全文搜索：D1 FTS5 + trigram 分词，中文子串与英文大小写不敏感
- 嵌套评论、审核队列、访客评论开关、频率与长度限制
- 媒体库：图片 / MP4 / WebM 上传至 R2，图片按档位压缩，视频自动抽取封面
- 审计日志与文章 / 标签 / 媒体 / 配置的 JSON 导出
- RSS、sitemap、robots 动态生成

### 写作体验

- 带工具栏、快捷键、拖拽 / 粘贴上传、分栏预览与全屏的 Markdown 编辑器
- 本地草稿自动恢复，避免误关页面丢内容
- 内置 Cloudflare Workers AI（默认，无需 API Key），也可接入 OpenAI / DeepSeek / 任意 OpenAI 兼容服务，一键生成摘要、正文或使用后台浮动 AI 助手

### 定时写作

- 在后台「定时写作」页创建任务：填写生成提示词、目标位置（博客或某个专栏）与排期
- 每个任务可选「保存为草稿」或「直接发布上线」：前者生成后等你审核，后者到点即在前台可见
- 排期支持「仅一次 / 每天 / 每周 / 每月」+ 执行时刻（北京时间），可选首次执行日期与结束日期
- Worker 的 Cron Trigger 每 5 分钟唤醒一次，到期任务自动生成文章与封面图
- 封面可选「AI 生成 / AI 联网找图 / 指定图片 / 不设封面」:AI 生成与 AI 找图都会把图片存入 R2;「指定图片」支持媒体库图片或图片直链,外链在执行时下载入库(失败则保留原链接)
- 任务列表展示下次运行时间、上次结果与最近运行记录，可随时启用 / 停用或立即手动执行一次

### 站点定制

- 6 套预设配色，每套包含亮色与暗色两套中性色；自定义主色自动派生文字色与悬停 / 按下色
- 全局背景图、字体、字号、圆角、内容宽度、行距、代码高亮主题
- 顶栏位置（跟随 / 吸顶 / 固定 / 左侧）、样式、背景、对齐与顶部透明
- Hero 支持视频 / 图片 / 颜色背景、宽高、铺满、遮罩、文字颜色与对齐
- 首页模块显隐与排序、卡片样式 / 尺寸 / 毛玻璃、侧边栏位置、每页条数
- 页脚、社交图标、评论区、可选音乐播放器
- 自定义 CSS、页头 / 页尾 HTML 注入、访问统计
- 所有修改实时生效，无需重新构建

## 技术栈

| 关注点 | 选择 | 说明 |
| --- | --- | --- |
| 前端 | React 18 + Vite + React Router 6 | SPA，后台路由懒加载 |
| 样式 | TailwindCSS + CSS 变量 | 颜色 / 圆角 / 字体全部引用 CSS 变量，运行时换肤 |
| 后端 | Hono on Cloudflare Workers | 基于 Web 标准 API，边缘运行；`scheduled` 处理定时任务 |
| 数据库 | Cloudflare D1 (SQLite) | 参数化查询，边缘只读副本 |
| 全文搜索 | D1 FTS5 + trigram | 解决 SQLite 默认分词器无法切分中文的问题 |
| 对象存储 | Cloudflare R2 | 图片与视频，零出口流量费 |
| 缓存 | Cloudflare KV | 公开配置缓存、限流计数 |
| 认证 | JWT (HS256) + HttpOnly Cookie | 会话版本号支持全端登出 |
| 密码 | PBKDF2-SHA256（210k 迭代） | Web Crypto 原生支持，旧哈希登录时自动升级 |
| Markdown | marked + DOMPurify + highlight.js | 浏览器端渲染、净化与高亮 |

## 部署到 Cloudflare Workers

以下流程全部在浏览器中完成，不需要在本地安装 Node.js，也不需要执行构建命令。

> 本项目部署为 **Worker**（而非 Pages）：定时写作依赖 Worker 的 **Cron Trigger** 按固定频率唤醒，Pages 不支持定时触发。
> Worker 同时通过 `[assets]` 提供 `dist/` 里的静态资源，`run_worker_first` 让所有请求先经过 Worker。

### 1. Fork 仓库

打开本仓库，点击右上角 **Fork**，得到自己的副本。后续所有修改都提交到你的 fork。

### 2. 创建 Cloudflare 资源

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，在 **Storage & Databases** 中创建以下资源：

| 资源 | 名称示例 | 用途 | 需要记录 |
| --- | --- | --- | --- |
| D1 | `edge-blog` | 文章、评论、配置 | Database ID |
| R2 | `edge-blog-media` | 图片与视频 | 存储桶名称 |
| KV | `CACHE` | 配置缓存与限流 | Namespace ID |

### 3. 修改 `wrangler.toml`

在 GitHub 网页中打开 fork 里的 `wrangler.toml`，点击铅笔图标编辑：

- `name` 改成你的 Worker 名称
- `database_name` / `database_id` 换成第 2 步的 D1
- KV 的 `id` 换成第 2 步的 Namespace ID
- R2 的 `bucket_name` 换成你的存储桶名称
- `SITE_URL` 改成 `https://<Worker 名称>.<子域>.workers.dev`（或你的自定义域名）
- `ALLOWED_ORIGINS` 改成自己的域名；没有额外来源时留空即可

绑定名 `DB`、`MEDIA`、`CACHE`、`AI`、`ASSETS` 不要修改，`compatibility_date` 与 `nodejs_compat` 保持原样。`name` 同时决定默认的 `<name>.<子域>.workers.dev` 地址，需要全局唯一。

> `[ai] binding = "AI"` 让 Worker 直接调用 Workers AI（默认 AI 服务商，无需 API Key；定时写作的封面图也用它生成）。如果不需要 AI，可以删除这段绑定与 `[triggers]`，后台的 AI 与定时写作入口会自动隐藏。

> `[triggers]` 中的 `crons = ["*/5 * * * *"]` 是 Worker 的定时轮询频率，与具体任务的执行时刻无关，通常不需要改。

### 4. 初始化远程数据库

新建的 D1 数据库是空的，必须先执行建表 SQL；否则业务接口都会返回 500。

> **⚠️ 要复制的是 SQL 文件的内容，不是文件名或路径。**
> 如果把 `migrations/0001_init.sql` 这样的路径粘贴进 D1 Console，SQLite 会把它当成 SQL 解析，
> 报 `near "migrations": syntax error at offset 0`。这不是 SQL 有问题，而是粘贴错了内容。

#### 方式 A：执行合并脚本（推荐，一次粘贴）

1. 打开 [`db/init.sql`](db/init.sql)，点击页面右上角的 **Raw**。
2. 全选（Ctrl/Cmd + A）并复制**整个文件内容**，第一行应该以 `--` 注释开头。
3. 回到 D1 数据库 → **Console**，把内容粘贴进 SQL 输入框，点击 **Execute**。
4. 确认每条语句都执行成功、没有红色错误。

`db/init.sql` 已按 `0001 → 0008 → seed` 的顺序合并好，**只适用于空库**。
重复执行会在 `ALTER TABLE ... ADD COLUMN` 处报 `duplicate column name`。
它由 `npm run db:bundle` 从下面的原始文件生成，CI 会校验两者是否一致。

#### 方式 B：逐个文件执行

对下表中每个文件重复「打开 → Raw → 复制全部内容 → 粘贴到 Console → Execute」，**顺序不能变**：

| 顺序 | 文件 | 作用 |
| --- | --- | --- |
| 1 | [`migrations/0001_init.sql`](migrations/0001_init.sql) | 用户、文章、标签、评论、设置、媒体、登录记录 |
| 2 | [`migrations/0002_fts.sql`](migrations/0002_fts.sql) | FTS5 全文搜索表与同步触发器 |
| 3 | [`migrations/0003_auth_hardening.sql`](migrations/0003_auth_hardening.sql) | 会话版本号、评论父级索引 |
| 4 | [`migrations/0004_write_amplification.sql`](migrations/0004_write_amplification.sql) | 触发器改写、登录记录索引 |
| 5 | [`migrations/0005_audit_and_soft_delete.sql`](migrations/0005_audit_and_soft_delete.sql) | 审计日志、文章软删除 |
| 6 | [`migrations/0006_media_thumbnail.sql`](migrations/0006_media_thumbnail.sql) | 视频封面字段 |
| 7 | [`migrations/0007_columns.sql`](migrations/0007_columns.sql) | 专栏表、文章归属字段 |
| 8 | [`migrations/0008_automation.sql`](migrations/0008_automation.sql) | 定时写作任务与运行记录 |
| 9 | [`migrations/0009_automation_cover_agent.sql`](migrations/0009_automation_cover_agent.sql) | 定时写作封面模式扩展(agent) |
| 10 | [`seed/seed.sql`](seed/seed.sql) | 默认管理员、示例文章与默认配置 |

#### 报错了怎么办

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `near "migrations": syntax error at offset 0` | 粘贴的是文件路径 | 改为粘贴文件内容 |
| `duplicate column name: token_version` / `deleted_at` / `thumbnail_url` / `column_id` | 该列已存在，库不是空的 | 跳过这条 `ALTER TABLE`，继续执行其余语句 |
| `not authorized: SQLITE_AUTH` | 脚本里有 D1 不允许的 PRAGMA | 使用本仓库当前版本（已移除 `PRAGMA foreign_keys`） |
| 页面 500，或 `/api/health` 返回 `data.db` 为 `uninitialized` | 迁移没有执行完 | 按上表顺序补齐，或执行 `db/init.sql` |
| `no such table` / `no such column` | 库结构与代码版本不一致 | 用 `db/init.sql` 初始化，或检查是否漏了某个迁移 |

如果库已被写坏、又没有任何需要保留的数据，最省事的做法是删除这个 D1 数据库，重新创建后把新的
`database_id` 填进 `wrangler.toml`，再执行一次初始化。

#### 命令行方式（可选）

本地装有 Node.js 时，可以让 wrangler 直接读取文件，完全避开复制粘贴：

```bash
npx wrangler login
npm run db:init          # 远程：执行 db/init.sql
npm run db:init:local    # 本地：执行 db/init.sql
```

已有数据、只想补跑某个迁移时，也可以单独执行：

```bash
npx wrangler d1 execute edge-blog --remote --file=./migrations/0006_media_thumbnail.sql
```

### 5. 创建 Worker

**Workers & Pages → Create → Workers → Import a repository**（或先创建 Worker 再在 **Settings → Builds** 里连接仓库），选择你 fork 的仓库与 `main` 分支，然后填写：

| 配置项 | 值 |
| --- | --- |
| Worker 名称 | 与 `wrangler.toml` 的 `name` 一致（不一致会构建失败） |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | 留空 |

保存后 Cloudflare 会自动开始第一次构建和部署。**部署统一走 Workers Builds**：push 到 `main` 后由 Cloudflare 拉取代码、构建并部署，不需要在本仓库保存 Cloudflare API Token。

仓库里的 GitHub Actions（`.github/workflows/ci.yml`）只做校验（SQL 打包一致性、lint、类型检查、测试、构建），不再负责部署，两条路径职责不重叠。

### 6. 设置密钥

Worker → **Settings → Variables and Secrets → Add**：

| 变量 | 类型 | 值 |
| --- | --- | --- |
| `JWT_SECRET` | Secret | 至少 32 字符的随机字符串，可用密码管理器生成 |

填写后点击 **Encrypt** 保存。

> 部署用的凭据由 Workers Builds 在连接仓库时自动创建，无需手动配置；`JWT_SECRET` 通过 Worker 的 Secret 设置，两处互不影响。

其余变量（`ENVIRONMENT`、`SITE_URL`、`SESSION_COOKIE`、`ALLOWED_ORIGINS` 等）已经写在 `wrangler.toml` 的 `[vars]` 中，修改文件即可；`JWT_SECRET` 必须通过 Secret 设置，不能写进仓库。

### 7. 部署

- **首次部署**：连接仓库后自动触发。
- **后续部署**：每次 push 到 `main` 自动构建并部署。
- **构建命令**：`npm run build`
- **部署命令**：`npx wrangler deploy`（本地手动部署等价于 `npm run deploy`）

构建完成后访问 `https://<Worker 名称>.<子域>.workers.dev`。若构建成功但页面报 500，优先检查 `JWT_SECRET` 是否已配置、D1 迁移是否执行、绑定名是否正确。

> Cron Trigger 会随 Worker 一起部署，无需额外配置；在 Worker → **Settings → Triggers** 可以看到 `*/5 * * * *`。

### 8. 自定义域名（可选）与首次登录

默认已可用 Worker 自带域名 `https://<Worker 名称>.<子域>.workers.dev`。要绑定自己的域名，需先让该域名成为**当前 Cloudflare 账户下的 active zone**（即在注册商处把 NS 指向 Cloudflare，完成接入），再在 Worker → **Settings → Domains & Routes → Add → Custom Domain** 添加域名，最后把 `wrangler.toml` 的 `SITE_URL` 改成该域名并提交一次部署。

> **注意**：Workers 的 Custom Domain 要求域名是账户内的 zone，**不支持外部 DNS 的 CNAME 接入**，这点与 Pages 不同。若域名托管在其他服务商（域名无法/不便迁入 Cloudflare），继续使用 `workers.dev` 域名即可，功能完全不受影响。媒体以相对路径 `/media/<key>` 保存，换域名无需迁移数据。

打开 `/admin`，使用下方默认账号登录并立即修改密码。

### 默认账号

| 用户名 | 密码 | 权限 |
| --- | --- | --- |
| `admin` | `admin12345` | admin |

> **部署后请立即修改密码**，可在登录后进入 `/admin` 修改，或使用 `npm run hash-password -- "新密码"` 生成哈希后更新 `users` 表。

## 环境变量

| 变量 | 配置位置 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | Dashboard Secret | 签署 JWT 的密钥，≥ 32 字符；缺失或过短时 API 直接返回 500 |
| `ENVIRONMENT` | `wrangler.toml` | `production` / `development`；开发环境 Cookie 不加 `Secure`，并允许 http 内网 AI 地址 |
| `SITE_URL` | `wrangler.toml` | 站点对外地址，用于 canonical / RSS / sitemap / OG |
| `MEDIA_PUBLIC_BASE` | `wrangler.toml` | 媒体公开前缀，默认留空（相对路径自动跟随访问域名）；仅当 R2 绑定了独立域名时设置 |
| `SESSION_COOKIE` | `wrangler.toml` | 会话 Cookie 名称，默认 `eb_session` |
| `ALLOWED_ORIGINS` | `wrangler.toml` | 额外允许的跨域来源，逗号分隔；同源始终允许，`*` 会被忽略 |

绑定：`DB`（D1）、`MEDIA`（R2）、`CACHE`（KV）、`AI`（Workers AI，可选）、`ASSETS`（Worker 静态资源）。

## 本地开发

需要 Node.js ≥ 18.18 与 Cloudflare 账号（`npx wrangler login`）。

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入 JWT_SECRET
npm run db:init:local            # 首次：建表 + 种子数据（见下方说明）

npm run dev:worker  # 构建前端并启动 Worker，http://127.0.0.1:8788
```

> `dev:worker` 通过 `wrangler dev` 运行完整 Worker，**会加载 D1 / R2 / KV / AI 绑定**，API、定时写作与 AI 接口都可用。
> 也可以用 `npx wrangler dev` 触发定时器测试：`npx wrangler dev --test-scheduled` 后访问 `/__scheduled`。

> `db:init:local` 只适用于全新的本地数据库；已经有本地数据时不要重复执行，
> 改用 `npm run db:migrate:local` 补齐迁移，或用 `npm run db:seed:local` 单独写入种子数据。

只调试前端时，另开一个终端运行 `npm run dev`，Vite 会把 `/api` 代理到 `8788`。

## 可用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（HMR，`/api` 代理到 8788） |
| `npm run dev:worker` | 构建前端并用 wrangler 运行完整 Worker（含绑定与定时器） |
| `npm run build` | 类型检查 + 构建到 `dist/` |
| `npm run typecheck` | 前后端两套 tsconfig 类型检查 |
| `npm run lint` | ESLint（零警告） |
| `npm test` | Vitest 单元测试 |
| `npm run deploy` | 构建并部署到 Cloudflare Workers（`wrangler deploy`） |
| `npm run db:bundle` | 把迁移与种子数据合并生成 `db/init.sql` |
| `npm run db:init[:local]` | 用 `db/init.sql` 初始化全新数据库（远程 / 本地） |
| `npm run db:migrate[:local]` | 逐个应用 D1 迁移（远程 / 本地） |
| `npm run db:seed[:local]` | 写入种子数据（远程 / 本地） |
| `npm run db:reset:local` | 等同 `db:init:local`（不会删除已有本地库） |
| `npm run hash-password -- "密码"` | 生成 PBKDF2 密码哈希 |

## 项目结构

```
functions/              Worker 入口（Hono）：API、R2 代理、SEO 注入、RSS / sitemap / robots、定时任务
src/
  pages/                前台页面 + admin 后台页面
  components/           layout / ui / blog / admin 组件
  providers/            Settings（主题与配置）/ Auth / Toast
  lib/                  API 客户端、Markdown 渲染、主题引擎、格式化
  styles/               tokens.css（设计令牌）+ globals.css
shared/                 前后端共享类型、默认配置与排期计算
migrations/             D1 迁移（建表、FTS5、审计、软删除、定时写作等）
db/init.sql             合并后的初始化 SQL（npm run db:bundle 生成）
seed/                   示例文章、默认设置与管理员
scripts/                密码哈希生成、SQL 合并脚本
public/                 静态资源
docs/screenshots/       README 界面截图
index.html              SPA 外壳（首屏防闪烁脚本、SEO / 配置注入占位）
wrangler.toml           Worker + 静态资源 + Cron Trigger + D1 / R2 / KV 绑定
```

## 定制与主题

所有可定制项按命名空间存于 `settings` 表（`site`、`theme`、`layout`、`navigation`、`social`、`features`、`advanced`、`comments`、`pages`），后台按页面区域分组展示，保存后通过 CSS 变量与 `data-theme` 实时生效。

- **主题**：设计令牌集中在 `src/styles/tokens.css`，采用 RGB 通道三元组，Tailwind 通过 `rgb(var(--c-x) / <alpha-value>)` 引用。`applyTheme()` 将配置写入内联 CSS 变量，并按主色的 WCAG 对比度自动选择前景色。
- **防闪烁**：`index.html` 内嵌阻塞式脚本，在首屏绘制前恢复 `data-mode` / `data-theme`；服务端同时注入合并后的公开配置（`#eb-boot-settings`），首帧即为真实站点信息。
- **Hero**：背景按视频 → 图片 → 颜色依次回退，视频静音播放，可设置循环或播放一次，以及自定义循环区间。整段循环或单次播放只挂载一个 `<video>`；只有自定义区间循环才启用双解码面，第二个视频在第一段开始播放后才加载，切点原子换层，无黑帧或 seek 卡顿。移动端不加载视频，直接使用封面图。
- **卡片**：`cardStyle` 控制五种卡片形态，`cardSize` 控制密度，`cardBlur` 为卡片启用毛玻璃。

## AI 辅助写作与后台助手

AI 功能默认关闭，不会迁移或覆盖已有配置。后台「AI 设置」页（`/admin/ai`）提供两种接入方式：

- **Cloudflare Workers AI（默认）**：通过 `wrangler.toml` 中的 `[ai] binding = "AI"` 直接调用，无需 API Key。默认模型 `@cf/zai-org/glm-4.7-flash`，可在设置页手动输入或拉取其他文本生成模型。
- **OpenAI / DeepSeek / 自定义 OpenAI 兼容接口**：保存 API Key 后自动拉取模型列表，可配置 Base URL、温度、最大 Tokens 与提示词。已有配置会继续按原样工作。

开启后：

- 文章编辑器出现「AI 生成正文」「AI 生成摘要」入口
- 后台每个页面右下角出现可拖动的圆形 AI 助手，可对话式创建/修改文章、上传图片与视频、给视频设置封面、审核评论、查看统计，以及读取指定网页正文（http/https，HTML 转纯文本后供总结或改写）
- 助手执行的每次写操作都会写入审计日志（`via: 'ai'`）
- API Key 仅保存在服务端，接口只返回 `hasApiKey`；`/api/ai/generate` 与 `/api/ai/chat` 均由 Worker 代理请求

> 助手抓取网页与下载素材都走同一套地址校验：只放行 http/https，拒绝内网、回环与保留地址（含重定向后的最终地址），单页限 2MB。

### 联网搜索

助手提供两个联网工具：

- `web_search`：主通道通过 **Monid 搜索网关**（`api.monid.ai` → TinyFish 免费网页搜索）取回结果；失败或结果与关键词无关时回退 Cloudflare Web Search API。结果会做相关性校验：标题、摘要、链接里都找不到查询关键词（例如「雷军」被截成「雷」）就判为失败，不会把垃圾结果交给模型。
- `fetch_web_page`：读取指定网页正文（http/https），HTML 转纯文本后交给模型，默认 6000 字、上限 10000 字，单页 2MB。

Monid 搜索（推荐配置）：在后台「AI 设置 → 联网搜索」填入 `monid_live_…` 形式的 API Key 即可，Key 只保存在服务端。也可改用 `MONID_API_KEY` 环境变量 / secret 提供（后台配置优先）。该通道经 `api.monid.ai` 调用 TinyFish 的免费网页搜索，不消耗 Monid 钱包余额。

Cloudflare 兜底通道（可选；Monid 未配置或失败时使用）：

1. Cloudflare Dashboard → **AI Gateway** → 选中网关（默认 `default`）→ **Provider Keys** → 添加 Exa Key，别名填 `default`（即 BYOK，费用由 Exa 直接结算，可用每月 $10 免费额度）。
2. 需要换网关/供应商时，在 `wrangler.toml` 的 `[vars]` 里设置 `AI_GATEWAY_ID`、`SEARCH_PROVIDER`（`ceramic` / `exa` / `linkup`）、`SEARCH_BYOK_ALIAS`；省略 `SEARCH_BYOK_ALIAS` 时按 AI Gateway credits 计费。

> 两条通道都失败（或都未配置）时，助手会明确回报失败原因，不会编造搜索结果。

> Workers AI 调用会按 Cloudflare 账户的免费额度/用量计费，即使在本地的 `wrangler dev` 中也是如此。`npm run dev` 不会加载 Worker 与绑定，AI 相关接口不可用。

## 安全

- 所有 SQL 使用参数化查询
- Markdown 渲染后经 DOMPurify 净化，唯一入口为 `src/lib/markdown.ts`
- 登录与评论频率限制（KV 计数 + `login_attempts` 账本），AI 调用与上传另有配额
- 密码强度校验与 PBKDF2 加盐哈希，登录时自动升级旧哈希
- JWT 存于 `HttpOnly; Secure; SameSite=Lax` Cookie，写操作校验同源，`token_version` 支持会话吊销
- 上传校验 magic bytes、MIME 白名单与体积上限，入库失败回滚 R2 对象
- 统一安全响应头（CSP、nosniff、HSTS 等），预览域名自动 noindex
- CI 执行 lint / typecheck / test / build

## 贡献

欢迎提交 Issue 与 Pull Request。提交前请确保 `npm run lint`、`npm run typecheck` 与 `npm test` 全部通过。

## 许可证

本项目基于 [MIT License](LICENSE) 开源，© 2026 nyoung。
