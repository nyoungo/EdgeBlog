# EdgeBlog — 项目约定与踩坑记录

## Cloudflare Workers

### `run_worker_first = true` 时 `_headers` / `_redirects` 失效

`wrangler.jsonc` 里配置了 `"assets": { "run_worker_first": true }`，所有请求都会先进入
`functions/worker.ts`。此时静态资源目录下的 `_headers`、`_redirects` **不会**作用于
经过 Worker 的响应（Cloudflare 只在「直接由 assets 提供」的响应上应用它们）。

**解决**：不要依赖 `public/_headers`，把安全头与缓存策略集中写进 Worker。本项目在
`functions/worker.ts` 的 `decorateAsset()` 里统一施加：

- 所有静态资源响应补 `SECURITY_HEADERS`（CSP、nosniff、HSTS 等）
- `/assets/*`（内容哈希）→ `immutable` 长缓存
- `/favicon.svg` → 1 天缓存

（迁移到这个 Worker 时已删除 `public/_headers`，避免两处规则不一致产生误导。）

### Pages 不支持 Cron Trigger

定时任务必须部署为 Worker（`export default { fetch, scheduled }` + `wrangler.jsonc`
的 `triggers.crons`）。cron 表达式是部署级的、无法按任务动态生成，所以本项目采用
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
Domain 绑定到本 Worker（apex `068800.xyz` 302 跳 `www`），`wrangler.jsonc` 的
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

### Deploy to Cloudflare 按钮把 `.dev.vars.example` 当作线上 Secret 清单

按钮流程会读取仓库里的 `.dev.vars.example`（或 `.env.example`）让用户逐项填写 Secret。
这个文件里只能放真正的 Secret：早期模板里的 `ENVIRONMENT=development`、
`SITE_URL=http://localhost:8788`、`ALLOWED_ORIGINS=http://localhost:5173` 会被原样写成
线上 Secret 并覆盖 `wrangler.jsonc` 的 `vars`，结果是线上以开发模式运行（Cookie 不带
Secure）、canonical / RSS 指向 localhost。这些本地覆盖项现在保持注释，用户按需取消注释。
格式按官方模板写成 `KEY=value`（不要 `KEY = "value"`），避免按钮的 dotenv 解析器出错。

`JWT_SECRET` 的示例值故意写成不足 32 字符：留着它部署会直接 500 并提示补密钥，
比用一个「长度合法但公开」的占位值安全。

### 一键部署按钮的配置解析器比 wrangler 更严：用 `wrangler.jsonc`，不写尾逗号

点按钮直接报「解析 Wrangler 配置文件时出现问题。请在 Workers SDK 存储库中提交问题。」
时，别只盯着 `wrangler.*`：这个报错来自 `template-from-worker` 端点，实际校验的是
整份模板元数据（`package.json` 的 `cloudflare` 块、`.dev.vars.example` 也在其中），
所以信息会指向错误的文件；并且判定结果按仓库缓存约 30 分钟，**改完要开无痕窗口重试**，
否则看到的还是旧结论。

已核实的边界（对照官方 41 个按钮模板）：

- 全部是 `wrangler.json` / `wrangler.jsonc`，**没有一个** `wrangler.toml`；
- jsonc 允许 `//` 注释，但**不允许尾逗号**——wrangler 容忍尾逗号，仪表盘不容忍；
- 空字符串变量是允许的（官方有 `"CUSTOM_DOMAIN": ""`），不必为此删掉 `SITE_URL`；
- `cloudflare.categories` 只用官方出现过的值（`ai` / `starter` / `storage` / `[]`）。

本项目约定：只保留 `wrangler.jsonc`（严格 JSON + `//` 注释，无尾逗号），改完用
`npx wrangler deploy --dry-run` 验证；`.dev.vars.example` 一律写 `KEY=value`。

### 一键部署的数据库自举看表结构，不要用 `d1 migrations apply`

现网 D1 没有 `d1_migrations` 记录表（早期是手工执行 SQL 建的库），
`wrangler d1 migrations apply` 会从 0001 重放，在 `ALTER TABLE ... ADD COLUMN`
处报 `duplicate column name`。所以 `npm run deploy` 先跑 `scripts/db-bootstrap.mjs`：

- 查不到 `users` 表 → 执行 `db/init.sql`（0001–0010 + seed），空库一次建好；
- 已有库 → 直接跳过，绝不写任何数据；
- 建完再查 `settings` 行数，为 0 时补跑幂等的 `seed/seed.sql`。

迁移文件本身仍是「空库一次性执行」语义，升级老站点要逐个手跑新增的迁移。
另外 Node 18.20+/20.12+ 在 Windows 上 `spawn('wrangler.cmd')` 会抛 `EINVAL`，
脚本统一用 `process.execPath` 执行 `node_modules/wrangler/bin/wrangler.js`。

所有 `wrangler d1 execute` 一律写**绑定名** `DB`，不写数据库名 `edge-blog`：
一键部署允许用户把库改成别的名字，写死库名会让那些命令直接失效。

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

### 定时发文「Workers AI 请求超时」多半是自己的应用超时,不是网络

`runDueAutomationTasks` 报 `Workers AI 请求超时,请稍后重试` 时,先看
`automation_runs` 的 `started_at`/`finished_at`:失败记录都**恰好差 60s / 120s**,
说明触发的是代码里的请求超时,而不是 Cloudflare 握手/网络问题。
实测线上 `@cf/qwen/qwen3.8-27b`(`max_tokens=20480`)生成一篇早报要 **~115s**,
早期的 60s 默认上限必然误杀正常请求。

**不要指望控制台的 gRPC 开关**:`Network → gRPC` 只作用于接入自有源的 gRPC 流量,
与 Workers AI **binding**(`env.AI.run`)的调用链路无关。

**解决**(`functions/lib/ai.ts` / `functions/lib/automation.ts`):

- 请求超时不再是硬编码常量:后台「AI 设置」里的 `timeoutMs` 决定单次请求最长等多久,
  默认 **300 秒(5 分钟)**,由 `normalize()` 夹在 `AI_TIMEOUT_MIN_MS = 10_000` 与
  `AI_TIMEOUT_MAX_MS = 900_000`(Cron 墙钟)之间;老设置的 JSON 里没有该字段时自动回落默认值;
- `aiChatComplete` / `chatComplete` / `aiChatStream` 都默认取这个值,只有工具循环为了
  「不拖过 Cron 墙钟」才会传更紧的剩余预算;
- 租约 `LEASE_MINUTES` 由 10 提到 **15**(= Cron Trigger 墙钟上限):定时器每 5 分钟
  一轮,若租约短于单次执行(正文 6 分钟 + 封面 3 分钟预算),任务没跑完就会被重复认领、重复发文。

### 长文写作必须走流式:非流式请求有约 120s 硬上限(`3046`)

调大超时不等于能写长文。Workers AI 对单次**非流式** `env.AI.run` 有约 120s 上限,
超时直接返回 `3046: Request timeout`(与「AI 设置」里的 `timeoutMs` 无关,调多大都没用)。
实测源头「每日早报」4 个链接 × 3000 字资料,成文轮要 **222s**,非流式必失败。

**解决**(`functions/lib/ai.ts` 的 `aiChatStream`):

- `stream: true` 拿 `ReadableStream`,按 SSE 分片聚合成完整文本;流式只要分片持续到达
  就不受 120s 限制;
- 仍保留两层上限:整体超时取设置里的 `timeoutMs`(默认 300s),
  `STREAM_IDLE_TIMEOUT_MS = 90_000` 管「多久没收到任何分片就算连接已死」,
  且静默上限不会超过整体上限。推理模型的 reasoning 分片也算「有内容」,
  不会把「想得久」误判成卡死;
- 兼容三种分片形态:`choices[].delta`、`choices[].message`、旧版顶层 `{ response }`;
  模型不支持流式直接返回完整对象时退化成一次普通解析。

### 定时发文必须两阶段:先取数、再流式成文

`generateArticle` 原来只有一次 `chatComplete`,没给 `tools`,模型只能凭记忆编内容。
改走 `runToolAgent` 后要注意两点,否则会从「编内容」变成「超时」:

- **取数轮只给 1 轮**(`ARTICLE_AGENT_TOOL_ROUNDS = 1`)。不设限时实测 6 轮全在抓详情页,
  0 字正文、245s 白跑;系统提示要求「第一轮一次性读完所有链接,不要抓二级页面」;
- **成文轮必须收回工具 + 走流式**。`streamFinal: true` 时前 `toolRounds` 轮用
  `aiChatComplete`(要结构化的 `tool_calls`),之后插入「资料已取完,立即成文」提示,
  改用 `aiChatStream`;
- 取数轮就写出正文的**丢弃重写**:那时还没读资料,这段正文必然是凭记忆编的;
- 上下文要确定性压制:`ARTICLE_AGENT_TOOL_RESULT_CHARS = 3500` 截断单条工具结果,
  并让模型 `maxChars: 3000`。实测 4 页 × 3000 字 ≈ 225s,放大到 6000 字会逼近 300s 上限。

### 「看图写文」:视觉输入走 content parts,且封面必须先于正文解析

`ChatMessage.content` 原来只接受字符串,视觉模型需要 OpenAI 风格的分片:
`[{ type: 'text', text }, { type: 'image_url', image_url: { url } }]`。Workers AI 的
`@cf/qwen/qwen3.8-27b` 与 OpenAI 兼容接口都接受这个形态;`llama-3.2-11b-vision-instruct`
顶层 `image` 参数在官方 schema 里已标记 deprecated(「use image as a part of messages now」),
不要照旧教程写成顶层参数。

顺序是硬约束:`performGeneration` 在 `cover_mode='fallback'` 且 `cover_describe=1` 时,
必须先 `resolveFallbackCover` → `describeCoverImage`,再把描述拼进 `generateArticle`
的写作要求。若沿用「正文先生成、后配封面」的旧顺序,描述只能影响下一轮,这轮文章拿不到。

图片统一转 data URI 再发:站内 `/media/...` 是相对地址,模型侧访问不到。上限取 4MB,
免费版每个请求只有 10ms CPU,更大的图直接跳过描述(正文照常生成),不要为了「都能描述」
把上限放大到 8MB。

## 微信公众号草稿推送

### 推送必须带「整条链路」的总预算,单请求超时拦不住 524

早期每步外部调用都只包自己的 30 秒:`fetchWithTimeout` 管微信接口、
`REMOTE_FETCH_TIMEOUT_MS` 管外链图下载。一步没超时,但推送要串行做「取图 →
uploadimg(每张一次) → add_material → draft/add」,几张图的耗时一叠加就可能顶穿
Cloudflare 边缘 **125 秒的 Proxy Read Timeout**(`Error 524: a timeout occurred`),
用户看到的就是「一直等、最后 524」。

**解决**(`functions/lib/deadline.ts`):

- `Deadline` 记录总预算剩余,`take(cap, msg)` 让每次调用的超时 = min(单次上限, 剩余);
  耗尽时立刻抛 `上游错误`,不发起下一次请求;
- `withTimeout(task, ms, msg)` 把 **fetch + 读取响应体** 放进同一个 AbortController:
  只包 fetch 不够——对方发完响应头不再发 body 时 `response.json()`/`arrayBuffer()`
  会一直挂着,表现和「推送卡死」一模一样;
- `WECHAT_PUSH_BUDGET_MS = 100_000`(后台按钮同步请求,留 25 秒给 524 前的余量),
  定时任务里「修复 + 重推」用 `WECHAT_REPAIR_TOTAL_BUDGET_MS = 240_000`,并给重推
  留 45 秒保底;
- 超时错误要带阶段(「取第 N 张正文图片（xxx）」「封面图」「写入草稿」),否则线上
  只看到「推送超时」根本没法判断是图多还是接口慢。

前端同样要设上限(`src/lib/api.ts`):`fetch` 挂死时界面会无限转圈。普通接口 30 秒,
公众号推送 130 秒、AI 生成 330 秒、手动跑定时任务 660 秒——都比服务端自己的预算大一点,
让服务端先返回明确原因。

### 微信正文图片 URL 必须来自 `media/uploadimg`，外链会被过滤

`draft/add` 的 `content` 是 HTML，但图片 `src` 只接受 `media/uploadimg` 返回的
`mmbiz.qpic.cn` 地址；直接塞本站 `/media/...` 或任意外链，微信会**静默丢弃图片**。
所以渲染阶段先把每张图写成占位符 `{{WXIMG:n}}`（`functions/lib/wechat-render.ts`），
上传成功后再用 `substituteWechatImages()` 按索引回填。

另外 `uploadimg` 只收 **jpg/png 且单张 < 1MB**；`material/add_material?type=image`
（封面永久素材）才收 bmp/png/jpeg/jpg/gif 且 ≤10MB。两者的限制不同，不要混用。
按用户要求，格式/体积不符一律**指名报错**（第 N 张 / 封面），不静默跳过或降级。

### 推送前统一压缩：正文图、封面、卡片配图都先压再传

早期是「取图 → 校验 → 不达标就报错」，用户得自己先把图压好。后来改成
`pushPostToWechatDraft` 在 `uploadimg` / `add_material` 之前调用
`compressForPush()`（内部是 `prepareImageForUpload`，目标 1440px / 900KB）。

**但这条路径只在 Workers 付费版可用**：免费版每个请求只有 **10ms CPU**，
wasm 解码/编码一张图要 100ms 以上，请求会被边缘直接终止并返回 `Error 1102`，
前端拿不到 JSON，只能显示「请求失败」。所以默认
`wechat.serverImageProcessing = false`：

- 关闭时（默认，免费版）：Worker 只按文件头 MIME 与体积做校验，需要转换的图
  （webp/avif、正文图 >1MB）**指名报错**；转换由文章编辑页在浏览器侧完成
  （`src/lib/wechat-prepare.ts`：Canvas 解码 → 缩到 ≤1440px → JPEG → 重新上传
  到媒体库 → 改写正文/封面地址 → 先保存再推送）。定时任务跑在 Worker 里，
  **没有 Canvas**，所以只有生成出来的 PNG（flux）或已合规的 jpg/png 封面能推；
  外链 webp 封面会带图名报错并跳过公众号同步（正文照常发布）。
- 配了远程压缩接口（`imageCompressUrl`，见下）时：需要转换的图先 POST 给该接口，
  返回 jpeg/png 后再上传。Worker 只做 I/O，免费版也能用。
- 开启 `serverImageProcessing` 时（付费版）：恢复服务端 wasm 压缩，逻辑如下：

- 已经合规的 jpg/png 走直通分支，**不碰 wasm**，既不慢也没有 128MB 内存风险；
- webp / 超宽 / 超重的图在内存里解码 → JS 盒式缩放 → 重编码成 jpeg；
- GIF / BMP 没有解码器，原样返回：封面接口本身收这两种格式，正文接口不收，
  仍由 `validateWechatContentImage()` 指名报错（不要为此把它们也丢进 wasm）；
- 封面只读一次、压一次，`bodyCoverPosition` 插入正文的那张（`shareCoverSource`）
  与 `thumb_media_id` 复用同一份字节（不接受二次压缩）——随机图片接口每次访问
  可能返回不同图片；
- 压缩后格式可能从 webp 变成 jpeg，文件名后缀要跟着换（`withMimeExtension()`），
  否则微信按后缀判类型；
- 压缩耗时计入整条推送的 100 秒预算，所以 `compressForPush()` 先
  `ensureBudget()`，超时报「卡在压缩第 N 张正文图片」，而不是让边缘先 524。

压缩仍然失败（图太大压不下去、文件损坏）时保留原有的「指名报错 + AI 修复重推」
兜底（`wechat-repair.ts`）；AI 修复同样依赖 wasm，所以只在
`serverImageProcessing` 开启时才触发。

> 前端拿不到 JSON 时别只显示「请求失败」：`src/lib/api.ts` 的
> `describeNonJsonResponse()` 会把 `Error 1102` 等边缘错误翻成可读原因，
> 这是区分「应用报错」与「Worker 被终止」的唯一线索。

### 远程压缩接口：可行，但只能当「转码 + 中度压缩」，不能当 resize 用

免费版替代 wasm 的另一条路是配 `wechat.imageCompressUrl`（默认空 = 关闭）：
Worker 把图片 POST 过去、拿回二进制，全程 I/O，不占 CPU。实现见
`functions/lib/image-compress-remote.ts`，调用点统一收在
`wechat-draft.ts` 的 `preparePushImage()`：付费版 wasm > 远程接口 > 指名报错，
合规的 jpg/png 直接上传，不会白耗额度。

按两种真实接口实现，差异都收进了设置，不要为某个服务写死：

| 设置 | uapis.cn | compress.scdn.io |
| --- | --- | --- |
| `imageCompressUrl` | `…/compress?format=jpeg&level=1` | `…/compress.php` |
| `imageCompressField` | `file` | `image` |
| `imageCompressParams` | 空（参数走 URL 查询串） | `quality=75&outputFormat=jpeg&response=binary` |
| 成功响应 | `image/*` 二进制 | 默认 JSON（base64 在 `data`），`response=binary` 时为二进制 |

要点：

- 文件字段名与附加表单参数都可配置；代码不再自动追加任何查询参数或表单参数。
  管理员在地址/参数里没写对时，输出仍会按微信 jpg/png 与体积限制校验并指名报错；
- 响应两种都识别：`Content-Type` 含 json（或正文以 `{` 开头）就按
  `{ success, data, format }` 解析并解 base64；`success=false` 时把 `message` 带进错误；
- uapis 实测：100KB 图约 **2 秒**；4MB 图约 **37 秒**；10MB 图对方直接 **524**——
  所以单张超时必须独立收窄（`REMOTE_COMPRESS_TIMEOUT_MS = 25s`，且不超推送总预算）；
- 两个接口都**没有宽高 / 目标体积参数**，4MB 的图压完仍可能 >1MB。因此输出必须重新
  sniff 文件头 + 按微信限制校验，不达标就指名报错，不能假设「压过就合规」；
- uapis 匿名额度约 1500 积分/30 天、2 积分/次（≈750 次），4 QPS；scdn 接口无需鉴权。
  只有「微信不能直接收的图」才调用，重复推送不会重复计费；
- 支持可选 `Authorization: Bearer <key>`，Key 与 AppSecret 同等待遇（只存服务端、
  视图里只回 `hasImageCompressToken`）。

不要把它接成「先传原图再替换」或「每次推送都压一遍」：前者白存原图，后者既慢
又烧额度。定时任务的外链 webp 封面是它最主要的用武之地。

### 定时推送被上传式压缩接口拦成 456：加一层「按 URL 转码」兜底

定时发文报 `第 N 张正文图片(…) 远程压缩失败（HTTP 456：<script src="/_guard/html.js?js=p456"></script>）`，
但手动点推送同一篇文章能成功——差别不在图，在调用方：

- **手动推送**：编辑器 `src/lib/wechat-prepare.ts` 先在浏览器里用 Canvas 把图转成 ≤900KB 的
  jpg 并重新入库，Worker 拿到的已经是合规图，`preparePushImage()` 直接放行，**根本不会调远程接口**；
- **定时任务**：没有 Canvas，1MB 以上的外链 jpg 只能交给 `imageCompressUrl`；而
  compress.scdn.io / uapis.cn 这类上传式接口普遍带 JS 反爬（加速乐 `_guard`），对 Cloudflare
  出站请求一律返回 **456**。同一张图同一份参数用本机 curl 是 200，所以别误判成「接口挂了」或
  「参数拼错」。

**解决**（`functions/lib/wechat-draft.ts` + `functions/lib/image-transform.ts`）：
`preparePushImage()` 按 `serverImageProcessing` → `imageCompressUrl`（POST 上传）→
`imageTransformUrl`（GET 代理）顺序尝试，后两步都只是 I/O，免费版也能跑。默认模板是
`https://wsrv.nl/?output=jpg&q=75&w=1440&we&bg=ffffff&url=`，地址必须以 `?url=` / `&url=`
结尾，代码只追加 `encodeURIComponent(原图地址)`（宽高质量由配置方自己拼）。注意：

- wsrv 会按域名策略拒绝部分 TLD（实测 `.xyz` 被拒，报 `Domain or TLD blocked by policy`），
  所以站内 `/media/...` 超限图仍需浏览器侧转换；站内地址要靠 `MEDIA_PUBLIC_BASE` 或
  `SITE_URL` 拼成绝对地址，两者都没配就跳过代理并说明原因；
- 两条路都失败时错误里会同时列出两个原因（不静默丢图）；
- 顺带修掉一个同类坑：封面若插进正文（`bodyCoverPosition != 'none'`），必须按**正文图**
  （<1MB、jpg/png）的标准准备。只按封面 10MB 的宽松限制准备，会在上传正文图那一步才被拒。

### `draft/add` 的 `thumb_media_id` 必填，且必须是永久素材 id

`thumb_media_id` 不能用 `uploadimg` 那种临时 URL，必须来自
`material/add_material`。没有封面的文章直接拒绝推送并提示先设封面，而不是推一个
微信会退回的草稿。`title` ≤ 32 字、`digest` ≤ 120 字、`content` < 2 万字符且 < 1M：
超长内容由 `truncateChars()`（按 Unicode 码点，避免截断 emoji 代理对）自动截断。

### 文末小程序卡片：官方 `<mp-common-miniprogram>` 会被 `draft/add` 拒(45166)，只能自绘 + 文字链接

用户要求「文章末尾加小程序卡片」时，第一反应是用 MP 编辑器复制来的
`<mp-common-miniprogram data-miniprogram-appid=... data-miniprogram-type="card">`。
实测（本地 curl 直连公众号接口）：**该标签无论带多少属性、`type` 是 `card` 还是其他，
`cgi-bin/draft/add` 都返回 `45166 invalid content`**；精简到官方文档《上传图文消息素材》
给出的最小形态也一样被拒。官方现在只在**旧图文素材**文档里给过卡片示例，草稿接口不认。

同一轮实测里，**文字链接写法被接受且属性被原样保留**：

```html
<a href="" data-miniprogram-appid="wx..." data-miniprogram-path="pages/index/index">点击进入小程序</a>
```

用 `draft/get` 读回草稿，`data-miniprogram-appid` / `data-miniprogram-path` 仍在，
自绘卡片的内联样式（`border-radius` 等）也没被剥掉。所以 `renderMiniprogramCard()`
（`functions/lib/wechat-render.ts`）走的是**自绘 section 卡片 + 文字链接**：图片、标题、
描述、按钮都包在带 `data-miniprogram-*` 的 `<a>` 里，样式全部内联。

> 前提：`data-miniprogram-appid` 对应的小程序必须与公众号有绑定关系，否则**点击不跳转**
> （接口不会因此报错，静默不生效）——所以这是需要人工在微信里预览点测的环节，代码层面
> 只能保证标签写对、属性不被过滤。

### 微信几乎总以 HTTP 200 返回，错误藏在 `errcode`

`stale`/`expired` access_token 不会是非 2xx，而是 `{errcode: 40001|42001|40014}`。
所以 `readEnvelope()` 先判 `errcode !== 0`，`withToken()` 再据此清缓存 + `force_refresh`
重取一次 token 重试。token 缓存在 KV（键 `wechat:token:${appId}`，提前 300s 过期），
`stable_token` 正常模式下有效期内返回同一个 token，缓存足够。

### 正文渲染不能复用前端的 marked + DOMPurify 链路

`src/lib/markdown.ts` 依赖 DOMPurify + DOM，Workers 运行时没有 DOM。服务端另起
`functions/lib/wechat-render.ts`，纯字符串渲染、全部样式内联（微信会剥 `<style>`
与外链样式），原始 HTML 直接丢弃。每次渲染新建独立 `Marked` 实例并在闭包里收集
图片地址，避免并发请求串味。

### 推送失败不应改变「文章已生成」的事实

定时任务的公众号同步是 **可选产物**：推送失败只把警告追加进 `automation_runs.message`
（与封面失败一致），保持任务 `success`。否则一次微信抖动会把正常生成的整篇任务标成失败。
去重用 `wechat_drafts(post_id UNIQUE)`，重复推送走 `draft/update` 更新既有草稿，
不在草稿箱堆重复项。

### 图片错误自动修复：只修图、不重写正文，判成功要看数据库是否真的变了

推送因正文图/封面的**格式或体积**失败时，`wechat-repair.ts` 先跑一次受限工具循环
（白名单只有 `compress_image_from_url` / `convert_image_format` / `replace_post_image`），
再由外层确定性地重推一次。要点：

- 只对 `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` 且消息里能定位到具体图片的错误
  触发；鉴权、限流、配置、正文超长不在范围内，否则会白白多打一次微信接口。
- 不给模型 `update_post`：整篇重写会把正文改坏，也容易超出上下文。替换走
  `replace_post_image` 的纯文本 `split/join`（图片 URL 带 `?` `&`，不能用正则）。
- **不能信模型说「已修复」**。判断标准是重新读库后 `content_md` / `cover_url`
  是否真的变了；没变就抛原始错误，保留真实失败原因。
- 修复后必须把新的正文/封面返回给编辑器并重置 baseline（`PostEditorPage`）。
  否则用户下一次保存会把旧图地址写回去，推送又失败一次。

### 微信的「2 万字符」统计的是渲染后的 HTML,不是 Markdown 字数

`draft/add` 文档对 `content` 的要求是「必须少于 2 万字符,小于 1M」——统计对象是
**最终发给接口的 HTML 字符串**,标签与内联样式全都算。实测线上文章:Markdown 7078
字符渲染成 18340 字符(2.6x),表格 / 链接多的到 4–5x。用户报「正文 6102 字却提示
24961 字符超限」时,那不是统计 bug,就是真实长度。

因为微信会剥掉 `<style>` 与 class 样式,每个 `<p>` / `<li>` / `<td>` 都必须挂内联
`style`,这部分通常占总长度的 60%–75%。所以**把文章改存 HTML 不会让这个数字变小**,
只是让你提前看见它。

**口径必须唯一**:`functions/lib/wechat-length.ts` 的 `buildWechatBody` 同时被真实
推送(`wechat-draft.ts`)、`POST /api/wechat/preflight`(编辑器实时预检)和 AI 的
`count_chars` 工具使用——任何一处自己再拼一遍正文,数字就会和推送时对不上。
唯一的估算项是图片地址:真实 mmbiz URL 要到推送时才生成。2026-11 对线上公众号
连传 4 次 8×8 PNG 实测(`media/uploadimg`),真实地址 154–162 字符、均值 **158**,
形如 `http://mmbiz.qpic.cn/sz_mmbiz_png/<路径>?wx_fmt=png`,所以
`WECHAT_IMAGE_URL_CHARS = 158`;每张图误差 ±10 字符以内,报告里同时返回
`imageUrlChars`,别把它当成精确值。

> 校准这条别去读草稿:`draft/get` 对已发表的草稿返回 `40007`,
> `freepublish/batchget` 在未认证订阅号上返回 `48001 api unauthorized`。
> 直接 `uploadimg` 传一张几十字节的合法 PNG 读回长度最省事,也不会在草稿箱留东西。
> 1×1 PNG 的手抄 base64 会被判 `40137 invalid image format`,自己用 zlib 编一张。

## 图片处理(WASM)

### Workers 里没有 sharp/canvas，编解码用 `@jsquash/*`，且必须按相对路径 import `.wasm`

- Workers 运行时没有 DOM、不能装原生模块，`sharp` 不可用；浏览器端的 Canvas 压缩
  （`src/lib/image-compress.ts`）也搬不过来。
- 本项目用 `@jsquash/jpeg` / `png` / `webp` 做解码，`jpeg` / `png` 做编码。WebP
  **只用于解码**：编码器 `webp_enc.wasm` 走 SIMD 动态导入，Workers 里不可靠，
  所以输出只有 JPEG/PNG。
- **缩放不用 `@jsquash/resize`**（已移除依赖）：它会把整张源位图再拷进 wasm 堆，
  12MP 的图光这一步就多占 48MB。改用 `image-process.ts` 的 `downscaleRgba()`
  做 JS 盒式缩放，只多分配目标尺寸的小缓冲区。
- wrangler 的 module collector 只认**相对路径**：`import wasm from
  '../../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm'`。写成包名
  （`'@jsquash/png/...wasm'`）会被当成相对源码目录的路径，报 `ENOENT`。
- `@jsquash/png` 包里自带的 `squoosh_png_bg.wasm.d.ts`（wasm-bindgen 导出的函数
  声明，没有 default）会**盖住** `%.wasm` 的通配声明，这一处用
  `// @ts-expect-error` 放行，其它 wasm 不需要。
- 体积：4 个 wasm 原始约 740KB、gzip 约 200KB，整个 Worker dry-run 后 gzip 约 450KB。
  改 wasm 依赖后用 `npx wrangler deploy --dry-run` 核对（Workers 免费版压缩上限 1MB）。

### 图片工具报 `unreachable` = wasm 内存不足，不是「图坏了」

`WebAssembly.RuntimeError: unreachable` 是 Rust/wasm-bindgen 侧的 abort：`squoosh_png`
与 `squoosh_resize` 在内存增长失败时只会抛这一句，没有任何上下文。Worker 只有 128MB，
一张 12MP 的图解码成 RGBA 就要 48MB，wasm 内部再放一份就是 96MB——加上原来的
`@jsquash/resize` 再拷一份，必然顶穿。更糟的是 **trap 之后这个 isolate 里的 wasm
实例已经被搞坏**，jsquash 的 `init()` 又是「已初始化就跳过」，后续所有图片处理都会
继续报 `unreachable`，直到 isolate 被回收。

**解决**（`image-codec.ts` + `image-size.ts` + `image-process.ts`）：

- `readImageSize()` 直接读文件头（PNG IHDR / JPEG SOFn / WebP VP8·VP8L·VP8X）拿尺寸，
  解码前按 `宽×高×4×2 + 输入×2` 估峰值，超过 `IMAGE_WORKING_BUDGET_BYTES`（104MB，
  约 14MP）直接给可读报错，不让 wasm 去撞内存墙；
- 解码结果**不整张复制**：jpeg/webp 解码器返回的是 wasm 堆里的视图，直接读它做缩放；
- 缩放改 JS 盒式缩放，编码器永远只看到缩放后的小图；
- 所有 wasm 调用用 `withWasmLock()` 串行化——jsquash 是 isolate 级单例，并发解码会
  互相覆盖同一块线性内存；
- 仍然可能出现的 trap 由 `runWasm()` 翻译成「超出 Worker 内存上限」的
  `PAYLOAD_TOO_LARGE`，而不是把 `unreachable` 直接抛给用户。

### 图片工具必须「先压缩再上传」，不要先传原图再替换

`compress_image_from_url` 的语义是**一次成型**：下载 → 内存里缩放/压缩 →
只把压缩结果写进 R2 与 `media` 表。不要写成「先 `upload_media_from_url` 传原图，
再压缩一份去 `replace_post_image` 替换」——那会白存一份原图、白做一次编码，
而且压缩失败时文章里留着的是超限的原图。

已经合规的图（jpg/png、宽度 ≤ maxWidth、体积 ≤ maxBytes）走
`prepareImageForUpload()` 的直通分支，**完全不碰 wasm**，既快也没有内存风险。

### Vitest 不能直接 import `.wasm`：用 `resolveId` 换成空模块

Node/Vite 会把 `.wasm` 当外部模块交给原生 loader，报
`Cannot find package 'wbg'`（把二进制当 JS 解析）。`vitest.config.ts` 里的
`wasm-stub` 插件把任何以 `.wasm` 结尾的 specifier 解析到 `tests/wasm-stub.ts`。
注意 **`resolve.alias` 不管用**——rollup 的 alias 会跳过相对路径，必须用插件。

### 媒体「未使用」判定必须偏保守，清理要分批

`functions/lib/media-usage.ts` 是唯一口径，列表徽标、`usage` 筛选、
`unusedMediaSummary()` 与 `POST /api/media/cleanup-unused` 都走它。判定范围包括：
文章 `cover_url` / `og_image` / `content_md`（含软删除的文章，回收站恢复后图还要
能用）、专栏封面、定时任务与运行记录封面，以及所有 `settings.value_json` 里出现过
的 key 或 URL。宁可漏清理，也不能删掉还能显示的图。

运行时先探测每个来源是否存在（`SELECT 列 FROM 表 LIMIT 1`），再拼最终 SQL（每个
isolate 缓存 5 分钟）。生产库是手工跑迁移的，缺表/缺列时只跳过那一项，媒体库不会
整页 500；一个来源都探测不到则直接报错，绝不把全部媒体标成「未使用」让清理删光。
列表接口本身也有降级：统计失败时返回不带 `in_use` 的列表，并把原始错误放进
`meta.usageError` 显示在页面顶部，避免「服务器内部错误」这种无信息量提示。

清理接口按批删除（默认 20、上限 30），因为免费版每个请求最多 50 个子请求，而每删一个
对象就是一次 R2 调用；它返回 `remaining`，由前端循环调用到 0。列表接口的
`stats=1` 才会计算 `in_use` 与未使用汇总——媒体选择器不传这个参数，省掉一次全表扫描。

`tests/media-usage.test.ts` 用 Node 内置 `node:sqlite` 真跑一遍判定 SQL。该模块只有
Node 22.5+ 才有，所以用例在拿不到时自动 skip（CI 固定 Node 22 以覆盖真实 SQL），
另有一条不依赖运行时的结构断言始终执行。注意 Vite 会把 `import ... from
'node:sqlite'` 误解析成裸模块 `sqlite`，测试里用 `createRequire` 加载。

## 数据层 / SQLite(D1)

### D1 的 `LIKE` / `GLOB` pattern 上限只有 **50 字节**，模糊匹配一律用 `instr()`

SQLite 默认允许 50000 字节，但 D1 把它压到 50 字节（官方 Limits 表：*Maximum
characters (bytes) in a LIKE or GLOB pattern = 50 bytes*）。超过就报
`D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR`。

最容易踩的是「用列值拼 pattern」：`content_md LIKE '%' || m.key || '%'` 里
`uploads/2026/11/thumbnail-xxxxxxxx.jpg` 这类 key 有 40+ 字符，加上两个 `%` 立刻超限；
中文按 UTF-8 3 字节算，搜索词 17 个字就超。**本地 SQLite / `wrangler dev` 不会报错**，
只有线上 D1 会，所以这类问题必须在代码层面避免，而不是靠本地测试。

**规则**：

- 只是判断「包含」→ `instr(列, ?) > 0`；需要大小写不敏感时
  `instr(lower(列), lower(?)) > 0`（`lower()` 只折 ASCII，与 `LIKE` 的默认行为一致）；
- 前缀匹配 → `substr(列, 1, length(?)) = ?` 或区间比较（见 `posts-write.ts` 的 slug 去重）；
- 只有固定的短 pattern（如 `mime LIKE 'image/%'`、1–2 个字的 FTS 退化搜索）才保留 `LIKE`。

`tests/media-usage.test.ts` 有一条结构断言直接检查判定 SQL 里不出现 `LIKE`，新增
模糊查询时照着这个思路补测试。

### 改 / 扩充列上的 CHECK 约束只能重建表,而 DROP TABLE 会级联删除子表行

SQLite 不支持 `ALTER TABLE ... ALTER COLUMN`,要改 `CHECK`(例如给
`automation_tasks.cover_mode` 增加 `'agent'`)只能「建新表 → 复制数据 → 删旧表 →
改名」。**坑点**:开启外键时 `DROP TABLE` 会先做隐式 `DELETE FROM`,如果别的表以
`ON DELETE CASCADE` 引用它(本项目的 `automation_runs.task_id`),子表的历史行会被
一起删掉;`PRAGMA defer_foreign_keys` 只能延后校验、**拦不住级联动作**。

**解决**(见 `migrations/0009_automation_cover_agent.sql`):先把子表备份到临时表
(`CREATE TABLE ... AS SELECT *`),重建父表后再原样恢复(恢复前先 `DELETE`,兼容
「级联未生效」的环境);`DROP TABLE` 会连索引 / 触发器一起删掉,重建后要一并补回。

### 后台文章列表按 `updated_at` 排,不能复用公开列表的「按发布时间」

草稿的 `published_at` 是 `NULL`,公开列表的 `newest`(`published_at DESC NULLS LAST`)
会把刚写好的草稿全部排到最后。后台关心的是「最近改过哪篇」,所以
`posts-repo.ts` 用独立的 `ADMIN_SORT_SQL`:newest/oldest/popular 一律按
`updated_at`(带 `p.id` 兜底,避免同一秒内顺序抖动)。新建的文章
`updated_at` 就等于创建时间,两种口径自然重合。

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

### 后台卡片统一走 `ui/Section`，不要再手搓「Card + 标题 + 内边距」

站点设置里的卡片（圆角 3xl、`shadow-lift`、浅底标题栏 + 图标 + 描述）已抽成
`src/components/ui/Section.tsx`，`appearance/ui.tsx` 只是再导出。新增后台页面时：

- 有标题的区块（设置、表单、表格、列表）→ `<Section title description icon actions>`；
- 表格 / `divide-y` 列表 → 传 `bodyClassName="p-0"`（列表再加 `space-y-0`，
  否则默认的 `space-y-4` 会和 `divide-y` 打架）；
- 只是想要同一套外壳（统计卡、媒体格子、逐条评论卡）→ `<Card variant="section">`，
  它只替换圆角和投影，不改变内容留白。

不要在页面里再定义局部 `Section`（`WechatSettingsPage` / `AiSettingsPage` 曾经各有一份，
样式与站点设置不一致）。

### Modal 面板必须能约束高度并内部滚动

面板加了 `max-h-full` + `flex flex-col`，内容区 `min-h-0 flex-1 overflow-y-auto`，
头部与页脚 `shrink-0`。否则内容超过视口时会被居中裁切、看不见也滚不到。
注意：`overflow-y-auto` 会裁掉内部 `absolute` 定位的下拉浮层，所以 **Modal 内不要放
`ComboBox`（或任何 absolute 弹层）**；原生 `Select` / `Input` 不受影响。

### 本地验证

`wrangler dev` 才会加载 D1/R2/KV/AI 绑定与定时器；`vite dev` 不会，AI 与定时接口
在纯 Vite 下不可用。测试定时器：`npx wrangler dev --test-scheduled` 后请求 `/__scheduled`。
