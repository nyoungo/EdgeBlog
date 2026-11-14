import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { WechatSettingsView } from '@shared/types';
import { WECHAT_DEFAULTS } from '@shared/settings-defaults';
import { api } from '../../lib/api';
import { formatUtc8 } from '../../lib/format';
import { useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { Card, EmptyState } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/icons';
import { cn } from '../../lib/utils';

type FormState = Omit<WechatSettingsView, 'hasAppSecret' | 'configured'>;

interface DraftRow {
  id: number;
  post_id: number;
  media_id: string;
  thumb_media_id: string | null;
  pushed_at: string;
  title: string;
  slug: string;
}

function toForm(view: WechatSettingsView): FormState {
  const { hasAppSecret: _hasAppSecret, configured: _configured, ...rest } = view;
  return rest;
}

/** Defaults with the view-only flags filled in; the stored secret is never loaded. */
function defaultsForm(hasAppSecret: boolean): FormState {
  const { appSecret: _appSecret, ...rest } = WECHAT_DEFAULTS;
  return toForm({ ...rest, hasAppSecret, configured: false });
}

function Section({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col p-5', className)}>
      <div className="mb-4 flex items-start gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Icon name={icon} size={17} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

/**
 * 微信公众号设置：AppID / AppSecret / 作者 / 评论开关。
 * 凭据只保存在服务端，前端只显示「是否已配置」。
 */
export function WechatSettingsPage() {
  const { settings } = useSettings();
  const { success, error: toastError } = useToast();

  const [form, setForm] = useState<FormState>(() => defaultsForm(false));
  const [hasAppSecret, setHasAppSecret] = useState(false);
  const [appSecret, setAppSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

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

  const save = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { ...form };
      if (clearSecret) patch['clearAppSecret'] = true;
      else if (appSecret.trim() !== '') patch['appSecret'] = appSecret.trim();
      const { data } = await api.patch<WechatSettingsView>('/wechat/settings', patch);
      setForm(toForm(data));
      setHasAppSecret(data.hasAppSecret);
      setAppSecret('');
      setClearSecret(false);
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
          <p className="text-xs leading-relaxed text-faint">
            封面取文章的封面图（微信 thumb_media_id 必填，无封面会拒绝推送）；正文图片会逐张上传到微信，
            仅支持 jpg/png 且单张小于 1MB。
          </p>
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
                      推送于 {formatUtc8(draft.pushed_at)} · 草稿 ID {draft.media_id.slice(0, 12)}…
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
    </div>
  );
}
