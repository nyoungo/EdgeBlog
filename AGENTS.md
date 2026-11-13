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
接受用 `<name>.<子域>.workers.dev` 对外（`SITE_URL` 指向它即可）。本项目最终走的是
前一条：把 `068800.xyz` 的 DNS 迁到 Cloudflare 后，`www.068800.xyz` 作为 Custom
Domain 绑定到本 Worker（apex `068800.xyz` 302 跳 `www`），`wrangler.toml` 的
`SITE_URL` 相应改为 `https://www.068800.xyz`。

> 注意区分：`functions/worker.ts` 的 `isPreviewHost()` 只把 `*.pages.dev` /
> `*.workers.dev` 判为预览域名（不索引），自定义域名不受影响，可直接被搜索引擎收录。

### 自动部署用 Workers Builds，不依赖仓库里的 API Token

`CLOUDFLARE_API_TOKEN` 一旦只授了 Pages 权限，`wrangler deploy` 会报
`No access to the specified resource.`（首次 Worker 部署会踩到）。与其维护 API Token，
不如用 **Workers Builds**：Worker → Settings → Builds 连接本仓库后，push 到 `main`
由 Cloudflare 自己拉代码、`npm run build`、`npx wrangler deploy`，并在连接时自动创建
所需 token。`.github/workflows/ci.yml` 只保留校验（bundle/lint/typecheck/test/build），
不再部署，避免同一版本被部署两次。

### Workers AI 推理模型的 `reasoning_content` 与正文共享 `max_tokens`

`@cf/zai-org/glm-4.7-flash`、`@cf/openai/gpt-oss-120b` 这类推理模型会先输出
`message.reasoning_content`，预算被推理耗尽时 `message.content` 就是 `null`，
`finish_reason` 为 `length`。只读 `content` 的代码会误判成「模型未返回内容」。

**解决**（`functions/lib/ai.ts`）：

- `textFromContent()` 兼容 `string | null | 数组分片 | { text }`，空正文识别不再只认字符串；
- `content` 为空且 `finish_reason === 'length'` 时，自动把 `max_tokens` 翻倍（下限 1024、
  上限 8192）重试一次；`reasoning` 已完整（非 `length`）时才允许兜底当正文返回；
- 空正文报错带上模型、`finish_reason`、token 用量，并提示改大预算或换非推理模型；
- 默认模型用 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（快、支持工具调用），推理模型
  速度快慢差异极大，同一条摘要 14s～65s 都可能。

`env.AI.models()` 的字段含义容易搞反:`id` 是**目录内部 UUID**
(`fd81c856-07a9-…`),真正能传给 `env.AI.run()` 的是 `name`(`@cf/作者/模型`)。
直接把 `id` 当模型名,设置页会显示一串乱码 UUID,保存后调用必然失败。取模型名一律走
`cloudflareModelId()`;历史遗留的 UUID 值由 `resolveCloudflareModel()` 回查目录纠正。

## 数据层 / SQLite(D1)

### 改 / 扩充列上的 CHECK 约束只能重建表,而 DROP TABLE 会级联删除子表行

SQLite 不支持 `ALTER TABLE ... ALTER COLUMN`,要改 `CHECK`(例如给
`automation_tasks.cover_mode` 增加 `'agent'`)只能「建新表 → 复制数据 → 删旧表 →
改名」。**坑点**:开启外键时 `DROP TABLE` 会先做隐式 `DELETE FROM`,如果别的表以
`ON DELETE CASCADE` 引用它(本项目的 `automation_runs.task_id`),子表的历史行会被
一起删掉;`PRAGMA defer_foreign_keys` 只能延后校验、**拦不住级联动作**。

**解决**(见 `migrations/0009_automation_cover_agent.sql`):先把子表备份到临时表
(`CREATE TABLE ... AS SELECT *`),重建父表后再原样恢复(恢复前先 `DELETE`,兼容
「级联未生效」的环境);`DROP TABLE` 会连索引 / 触发器一起删掉,重建后要一并补回。

## 前端

### `cn()` 必须做冲突消解，否则「组件默认值 + 调用方覆盖」会随机失效

`cn()` 若只用 `clsx` 拼接，`'max-w-md'` 与调用方的 `'max-w-3xl'` 会同时保留，谁生效
取决于 Tailwind 生成 CSS 的先后顺序（实测 `.max-w-md` 排在 `.max-w-3xl` 之后，调用方
覆盖失效）。表现为「弹窗永远 448px 宽」。**解决**：`cn()` 用
`twMerge(clsx(inputs))`，后写的同类工具类获胜。

本项目的自定义 scale（`maxWidth` / `boxShadow` / `zIndex` / `fontFamily` / `fontSize`
等，见 `tailwind.config.ts`）tailwind-merge 并不认识，覆盖自定义 token 时同样不会消解，
因此在 `src/lib/utils.ts` 里用 `extendTailwindMerge` 登记这些 token；**新增自定义
工具类时要同步登记**，否则那一个 token 的覆盖会静默失效。

### Modal 面板必须能约束高度并内部滚动

面板加了 `max-h-full` + `flex flex-col`，内容区 `min-h-0 flex-1 overflow-y-auto`，
头部与页脚 `shrink-0`。否则内容超过视口时会被居中裁切、看不见也滚不到。
注意：`overflow-y-auto` 会裁掉内部 `absolute` 定位的下拉浮层，所以 **Modal 内不要放
`ComboBox`（或任何 absolute 弹层）**；原生 `Select` / `Input` 不受影响。

### 本地验证

`wrangler dev` 才会加载 D1/R2/KV/AI 绑定与定时器；`vite dev` 不会，AI 与定时接口
在纯 Vite 下不可用。测试定时器：`npx wrangler dev --test-scheduled` 后请求 `/__scheduled`。
