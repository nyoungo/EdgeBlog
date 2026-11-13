# EdgeBlog — 项目约定与踩坑记录

## Cloudflare Workers

### `run_worker_first = true` 时 `_headers` / `_redirects` 失效

`wrangler.toml` 里配置了 `[assets] run_worker_first = true`，所有请求都会先进入
`functions/worker.ts`。此时静态资源目录下的 `_headers`、`_redirects` **不会**作用于
经过 Worker 的响应（Cloudflare 只在「直接由 assets 提供」的响应上应用它们）。

**解决**：不要依赖 `public/_headers`，把安全头与缓存策略集中写进 Worker。本项目在
`functions/worker.ts` 的 `decorateAsset()` 里统一施加：

- 所有静态资源响应补 `SECURITY_HEADERS`（CSP、nosniff、HSTS 等）
- `/assets/*`（内容哈希）→ `immutable` 长缓存
- `/favicon.svg` → 1 天缓存

（迁移到这个 Worker 时已删除 `public/_headers`，避免两处规则不一致产生误导。）

### Pages 不支持 Cron Trigger

定时任务必须部署为 Worker（`export default { fetch, scheduled }` + `wrangler.toml`
的 `[triggers] crons`）。cron 表达式是部署级的、无法按任务动态生成，所以本项目采用
「固定高频轮询（`*/5 * * * *`）+ `automation_tasks.next_run_at` 判到期」的方案；
排期字段按 UTC+8 语义收/发，换算成 UTC 后存入 `next_run_at`。

### Workers Custom Domain 要求域名是本账户内的 zone（与 Pages 不同）

Pages 支持用**外部 DNS 的 CNAME** 接入自定义域（域名不必托管在 Cloudflare）；Workers
的 **Custom Domain 不行**：它要求该域名是「当前 Cloudflare 账户下的 active zone」，
官方原文是 *"You cannot create a Custom Domain on a hostname with an existing CNAME
DNS record or on a zone you do not own."* 域名只能挂在 `workers.dev` 或其他账户内 zone
上，否则 `wrangler deploy` / Dashboard 添加自定义域都会失败。

**解决**：要么把域名 NS 迁到 Cloudflare（成为本账户 zone）后再加 Custom Domain；要么
接受用 `<name>.<子域>.workers.dev` 对外（`SITE_URL` 指向它即可）。本项目当前域名
`www.068800.xyz` 托管在华为云 DNS、且仍被旧的 Pages 项目占用，因此对外先用
`https://edge-blog.nyoungo.workers.dev`。

### 自动部署用 Workers Builds，不依赖仓库里的 API Token

`CLOUDFLARE_API_TOKEN` 一旦只授了 Pages 权限，`wrangler deploy` 会报
`No access to the specified resource.`（首次 Worker 部署会踩到）。与其维护 API Token，
不如用 **Workers Builds**：Worker → Settings → Builds 连接本仓库后，push 到 `main`
由 Cloudflare 自己拉代码、`npm run build`、`npx wrangler deploy`，并在连接时自动创建
所需 token。`.github/workflows/ci.yml` 只保留校验（bundle/lint/typecheck/test/build），
不再部署，避免同一版本被部署两次。

### 本地验证

`wrangler dev` 才会加载 D1/R2/KV/AI 绑定与定时器；`vite dev` 不会，AI 与定时接口
在纯 Vite 下不可用。测试定时器：`npx wrangler dev --test-scheduled` 后请求 `/__scheduled`。
