import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WechatSettingsView } from '@shared/types';
import { WECHAT_DEFAULTS } from '@shared/settings-defaults';
import { api } from '../../lib/api';
import { formatUtc8 } from '../../lib/format';
import { useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { EmptyState } from '../../components/ui/Feedback';
import { Section } from '../../components/ui/Section';
import { Icon } from '../../components/ui/icons';
import { MediaPicker } from '../../components/admin/MediaPicker';

type FormState = Omit<
  WechatSettingsView,
  'hasAppSecret' | 'hasImageCompressToken' | 'configured' | 'imageCompressToken'
>;

interface DraftRow {
  id: number;
  post_id: number;
  media_id: string;
  thumb_media_id: string | null;
  article_type: 'news' | 'newspic';
  pushed_at: string;
  title: string;
  slug: string;
}

function toForm(view: WechatSettingsView): FormState {
  const {
    hasAppSecret: _hasAppSecret,
    hasImageCompressToken: _hasImageCompressToken,
    configured: _configured,
    ...rest
  } = view;
  return rest;
}

/** Defaults with the view-only flags filled in; stored secrets are never loaded. */
function defaultsForm(hasAppSecret: boolean, hasImageCompressToken: boolean): FormState {
  const { appSecret: _appSecret, imageCompressToken: _token, ...rest } = WECHAT_DEFAULTS;
  return toForm({ ...rest, hasAppSecret, hasImageCompressToken, configured: false });
}

/**
 * 微信公众号设置：AppID / AppSecret / 作者 / 评论开关。
 * 凭据只保存在服务端，前端只显示「是否已配置」。
 */
export function WechatSettingsPage() {
  const { settings } = useSettings();
  const { success, error: toastError } = useToast();

  const [form, setForm] = useState<FormState>(() => defaultsForm(false, false));
  const [hasAppSecret, setHasAppSecret] = useState(false);
  const [appSecret, setAppSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [hasCompressToken, setHasCompressToken] = useState(false);
  const [compressToken, setCompressToken] = useState('');
  const [clearCompressToken, setClearCompressToken] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [cardPicker, setCardPicker] = useState(false);

  useDocumentTitle('公众号设置', settings.site.name);

  const loadDrafts = () => {
    api
      .get<DraftRow[]>('/wechat/drafts?limit=20')
      .then(({ data }) => setDrafts(data))
      .catch(() => setDrafts([]));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<WechatSettingsView>('/wechat/settings');
        if (cancelled) return;
        setForm(toForm(data));
        setHasAppSecret(data.hasAppSecret);
        setHasCompressToken(data.hasImageCompressToken);
      } catch (err) {
        if (!cancelled) toastError(err instanceof Error ? err.message : '加载公众号设置失败');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    loadDrafts();
    return () => {
      cancelled = true;
    };
  }, [toastError]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const secretConfigured = hasAppSecret && !clearSecret;
  const configured = form.appId.trim().length > 0 && secretConfigured;
  const compressConfigured = form.imageCompressUrl.trim().length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { ...form };
      if (clearSecret) patch['clearAppSecret'] = true;
      else if (appSecret.trim() !== '') patch['appSecret'] = appSecret.trim();
      if (clearCompressToken) patch['clearImageCompressToken'] = true;
      else if (compressToken.trim() !== '') patch['imageCompressToken'] = compressToken.trim();
      const { data } = await api.patch<WechatSettingsView>('/wechat/settings', patch);
      setForm(toForm(data));
      setHasAppSecret(data.hasAppSecret);
      setHasCompressToken(data.hasImageCompressToken);
      setAppSecret('');
      setClearSecret(false);
      setCompressToken('');
      setClearCompressToken(false);
      success('公众号设置已保存');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post<{ message: string }>('/wechat/test');
      setTestResult(data.message);
      success('微信接口连接正常');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  if (!ready) {
    return <div className="py-20 text-center text-sm text-faint">载入中…</div>;
  }

  return (
    <div className="pb-16">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">公众号设置</h1>
          <p className="mt-1 text-sm text-muted">
            把站内文章推送到微信公众号草稿箱；AppID / AppSecret 只保存在服务端
          </p>
        </div>
        <Button onClick={() => void save()} loading={saving}>
          <Icon name="save" size={16} /> 保存
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="启用与连通性"
          description="关闭后，文章编辑器与定时任务都不会推送草稿"
          icon="globe"
        >
          <Switch
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            label="启用公众号推送"
            description="允许手动/自动把文章同步到草稿箱"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={testing}
              disabled={!configured || !form.enabled}
              onClick={() => void testConnection()}
            >
              <Icon name="zap" size={15} /> 测试连接
            </Button>
            <span className="text-xs text-muted">
              {configured ? '已配置 AppID / AppSecret' : '尚未填写完整的 AppID / AppSecret'}
            </span>
          </div>
          {testResult && (
            <div className="rounded-xl bg-surface-2/60 p-3 text-xs leading-relaxed text-muted">
              {testResult}
            </div>
          )}
          <p className="text-xs leading-relaxed text-faint">
            提示：公众号后台「设置与开发 → 基本配置 → IP 白名单」若未启用，Worker 可直接调用微信接口；
            若已启用，需要把调用来源 IP 加入白名单，否则会报 40164。
          </p>
        </Section>

        <Section
          title="凭据"
          description="在公众平台「设置与开发 → 基本配置」中获取"
          icon="lock"
        >
          <Input
            label="AppID"
            value={form.appId}
            onChange={(e) => set('appId', e.target.value)}
            placeholder="wx1234567890abcdef"
            autoComplete="off"
          />
          <Input
            label="AppSecret"
            type="password"
            value={appSecret}
            onChange={(e) => {
              setAppSecret(e.target.value);
              if (e.target.value) setClearSecret(false);
            }}
            placeholder={secretConfigured ? '留空表示保持不变' : '粘贴 AppSecret'}
            autoComplete="off"
            disabled={clearSecret}
          />
          {hasAppSecret && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {clearSecret ? '保存后将清除已存的 AppSecret' : '已保存一个 AppSecret'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClearSecret((v) => !v);
                  setAppSecret('');
                }}
              >
                {clearSecret ? '取消清除' : '清除'}
              </Button>
            </div>
          )}
        </Section>

        <Section title="草稿内容" description="控制作者署名与评论开关" icon="fileText">
          <Input
            label="作者（选填）"
            value={form.author}
            onChange={(e) => set('author', e.target.value)}
            maxLength={16}
            placeholder="留空则不显示作者"
            hint="微信公众号限制 16 字，超出会自动截断"
          />
          <Switch
            checked={form.openComment}
            onChange={(v) => set('openComment', v)}
            label="自动打开评论"
            description="草稿发布后允许读者评论"
          />
          <Switch
            checked={form.onlyFansCanComment}
            onChange={(v) => set('onlyFansCanComment', v)}
            label="仅粉丝可评论"
            description="仅在「自动打开评论」开启时生效"
          />
          <Select
            label="正文中的封面位置"
            value={form.bodyCoverPosition}
            onChange={(e) => set('bodyCoverPosition', e.target.value as FormState['bodyCoverPosition'])}
            hint="仅影响公众号草稿正文，不修改站点文章；正文图需为 jpg/png 且单张小于 1MB。"
          >
            <option value="none">不插入</option>
            <option value="top">正文顶部</option>
            <option value="middle">正文中间</option>
            <option value="bottom">正文底部</option>
          </Select>
          <p className="text-xs leading-relaxed text-faint">
            封面取文章的封面图（微信 thumb_media_id 必填，无封面会拒绝推送）；正文图片会逐张上传到微信，
            只接受 jpg/png、单张 1MB 以内。编辑器点推送时会先在浏览器里把 webp 等格式自动转成 jpg。
          </p>
          <Switch
            checked={form.repairPushFailures}
            onChange={(v) => set('repairPushFailures', v)}
            label="图片错误时自动修复并重推一次"
            description="仅处理公众号正文/封面的图片格式或体积问题；需要同时开启下方「在服务端压缩图片」，且只在 Workers 付费版可用。"
          />
          <Switch
            checked={form.serverImageProcessing}
            onChange={(v) => set('serverImageProcessing', v)}
            label="在服务端用 wasm 压缩/转换图片（需要 Workers 付费版）"
            description="免费版每个请求只有 10ms CPU，开启后推送会在 wasm 压缩阶段被 Cloudflare 终止（Error 1102）。免费版请改用下方「远程图片压缩接口」，或直接用编辑器推送（浏览器会先转成 jpg）。"
          />
        </Section>

        <Section
          title="远程图片压缩（可选）"
          description="免费版替代 wasm 的方案：Worker 只把图片 POST 给该接口，做的是 I/O，不占 CPU"
          icon="image"
        >
          <Input
            label="压缩接口地址"
            value={form.imageCompressUrl}
            onChange={(e) => set('imageCompressUrl', e.target.value)}
            placeholder="https://compress.scdn.io/api/compress.php"
            hint="留空则关闭。需使用 https；查询参数可直接拼在地址上（如 uapis 的 ?format=jpeg&level=1）。"
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                set('imageCompressUrl', 'https://uapis.cn/api/v1/image/compress?format=jpeg&level=1');
                set('imageCompressField', 'file');
                set('imageCompressParams', '');
              }}
            >
              填入 uapis.cn 示例
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                set('imageCompressUrl', 'https://compress.scdn.io/api/compress.php');
                set('imageCompressField', 'image');
                set('imageCompressParams', 'quality=75&outputFormat=jpeg&response=binary');
              }}
            >
              填入 compress.scdn.io 示例
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="文件字段名"
              value={form.imageCompressField}
              onChange={(e) => set('imageCompressField', e.target.value)}
              placeholder="file"
              hint="multipart 里放图片的字段名：uapis 是 file，scdn 是 image。"
              autoComplete="off"
            />
            <Input
              label="附加表单参数（选填）"
              value={form.imageCompressParams}
              onChange={(e) => set('imageCompressParams', e.target.value)}
              placeholder="quality=75&outputFormat=jpeg&response=binary"
              hint="按表单字段追加，留空不传；scdn 建议加 response=binary（省 33% 带宽）。"
              autoComplete="off"
            />
          </div>
          <Input
            label="接口 API Key（选填）"
            type="password"
            value={compressToken}
            onChange={(e) => {
              setCompressToken(e.target.value);
              if (e.target.value) setClearCompressToken(false);
            }}
            placeholder={compressConfigured ? '留空表示保持不变' : '匿名调用可留空'}
            autoComplete="off"
            disabled={clearCompressToken}
            hint="以 Authorization: Bearer <key> 发送，只保存在服务端。"
          />
          {hasCompressToken && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {clearCompressToken ? '保存后将清除已存的 API Key' : '已保存一个 API Key'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClearCompressToken((v) => !v);
                  setCompressToken('');
                }}
              >
                {clearCompressToken ? '取消清除' : '清除'}
              </Button>
            </div>
          )}
          <Input
            label="图片转码接口地址（定时发文兜底）"
            value={form.imageTransformUrl}
            onChange={(e) => set('imageTransformUrl', e.target.value)}
            placeholder="https://wsrv.nl/?output=jpg&q=75&w=1440&we&bg=ffffff&url="
            hint="GET 方式：地址以 ?url= 或 &url= 结尾，代码只追加原图地址，宽高/质量由你拼好。留空表示不启用。"
            autoComplete="off"
          />
          <p className="text-xs leading-relaxed text-faint">
            定时任务跑在 Worker 里，既没有浏览器的 Canvas，免费版也跑不了 wasm，只能靠上面两个接口；
            而上传式接口普遍带 JS 反爬，Worker 出站请求会被拦成 HTTP 456 + _guard 脚本（手动推送因为
            浏览器先压好了图，不会走到这里）。所以默认再用 wsrv.nl 做「按 URL 转码」兜底：它走
            Cloudflare，Worker 出站可达。注意它按域名策略拒绝部分 TLD（实测 .xyz 被拒），站内
            /media 图片若超限仍需要在编辑器里先压缩。
          </p>
          <p className="text-xs leading-relaxed text-faint">
            只对「微信不能直接收」的图调用（webp/avif、正文图 ≥1MB），合规的 jpg/png 不会浪费额度。
            返回图片二进制或 JSON（base64 在 data 字段）都支持。实测 uapis.cn：100KB 约 2 秒、
            4MB 约 37 秒、10MB 会 524；匿名额度约 1500 积分/30 天、每次 2 积分。
          </p>
        </Section>

        <Section
          title="文末小程序卡片"
          description="在每篇推送文章末尾追加一张自绘样式的小程序卡片，点击跳转小程序"
          icon="sparkles"
          className="lg:col-span-2"
        >
          <Switch
            checked={form.miniprogramEnabled}
            onChange={(v) => set('miniprogramEnabled', v)}
            label="启用文末小程序卡片"
            description="需先在小程序与公众号后台完成关联，否则点击无法跳转"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="小程序 AppID"
              value={form.miniprogramAppId}
              onChange={(e) => set('miniprogramAppId', e.target.value)}
              placeholder="wx1234567890abcdef"
              autoComplete="off"
            />
            <Input
              label="页面路径"
              value={form.miniprogramPath}
              onChange={(e) => set('miniprogramPath', e.target.value)}
              placeholder="pages/index/index"
              hint="与小程序 app.json 一致，可带参数（?a=1）"
            />
            <Input
              label="卡片主标题"
              value={form.miniprogramTitle}
              onChange={(e) => set('miniprogramTitle', e.target.value)}
              placeholder="点击进入小程序"
              maxLength={64}
            />
            <Input
              label="按钮文字"
              value={form.miniprogramButton}
              onChange={(e) => set('miniprogramButton', e.target.value)}
              placeholder="点击进入小程序"
              maxLength={16}
            />
            <Textarea
              label="卡片描述（选填）"
              value={form.miniprogramDesc}
              onChange={(e) => set('miniprogramDesc', e.target.value)}
              rows={2}
              maxLength={120}
              placeholder="一句话说明小程序里有什么"
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">卡片配图（选填）</span>
              <div className="flex items-center gap-2">
                <input
                  value={form.miniprogramImage}
                  onChange={(e) => set('miniprogramImage', e.target.value)}
                  placeholder="https://… 或 /media/…"
                  className="w-full rounded-lg border border-border bg-surface-2/60 px-3.5 py-2.5 text-sm text-fg placeholder:text-faint transition-colors focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
                <Button type="button" variant="secondary" className="h-10 shrink-0" onClick={() => setCardPicker(true)}>
                  <Icon name="image" size={15} /> 选择图片
                </Button>
              </div>
              <p className="text-xs text-faint">
                卡片配图需为 jpg/png 且小于 1MB（微信正文图限制），留空则渲染无图卡片。
              </p>
              {form.miniprogramImage && (
                <img
                  src={form.miniprogramImage}
                  alt=""
                  className="mt-1 h-20 w-40 rounded-md border border-border object-cover"
                />
              )}
            </div>
          </div>
        </Section>

        <Section
          title="已推送的草稿"
          description="同一篇文章重复推送会更新既有草稿，不会新增重复项"
          icon="list"
          className="lg:col-span-2"
        >
          {drafts.length === 0 ? (
            <EmptyState
              icon="list"
              title="还没有推送记录"
              description="在文章编辑页点击「推送到公众号草稿」后，这里会列出对应的草稿。"
            />
          ) : (
            <ul className="divide-y divide-fg/5">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/posts/${draft.slug}`} className="text-sm text-fg hover:text-brand">
                      {draft.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-faint">
                      {draft.article_type === 'newspic' ? '图片消息' : '图文消息'} · 推送于{' '}
                      {formatUtc8(draft.pushed_at)} · 草稿 ID {draft.media_id.slice(0, 12)}…
                    </p>
                  </div>
                  <a
                    href="https://mp.weixin.qq.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    公众平台草稿箱
                    <Icon name="externalLink" size={13} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <MediaPicker
        open={cardPicker}
        onClose={() => setCardPicker(false)}
        onSelect={(item) => set('miniprogramImage', item.url)}
      />
    </div>
  );
}
