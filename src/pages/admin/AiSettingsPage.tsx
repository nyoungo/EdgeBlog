import { useEffect, useState, type ReactNode } from 'react';
import type { AiSettingsView, AiProvider } from '@shared/types';
import { AI_DEFAULTS } from '@shared/settings-defaults';
import { api } from '../../lib/api';
import { useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { ComboBox } from '../../components/ui/ComboBox';
import { Switch } from '../../components/ui/Switch';
import { Card } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/icons';
import { cn } from '../../lib/utils';

const PROVIDERS: Array<{ value: AiProvider; label: string; baseUrl: string; model: string }> = [
  {
    value: 'cloudflare',
    label: 'Cloudflare Workers AI（内置，推荐）',
    baseUrl: '',
    model: '@cf/zai-org/glm-4.7-flash',
  },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { value: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];

type FormState = Omit<
  AiSettingsView,
  'hasApiKey' | 'hasMonidApiKey' | 'bindingAvailable' | 'ready'
>;

function toForm(view: AiSettingsView): FormState {
  // View-only flags; the form holds the (write-only) keys itself.
  const {
    hasApiKey: _hasApiKey,
    hasMonidApiKey: _hasMonidApiKey,
    bindingAvailable: _bindingAvailable,
    ready: _ready,
    ...rest
  } = view;
  return rest;
}

/** Defaults with the view-only flags filled in; the stored keys are never loaded. */
function defaultsForm(flags: {
  hasApiKey: boolean;
  hasMonidApiKey: boolean;
  bindingAvailable: boolean;
}): FormState {
  const { apiKey: _apiKey, monidApiKey: _monidApiKey, ...rest } = AI_DEFAULTS;
  return toForm({ ...rest, ...flags, ready: false });
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

export function AiSettingsPage() {
  const { settings } = useSettings();
  const { success, error: toastError } = useToast();

  const [form, setForm] = useState<FormState>(() =>
    defaultsForm({ hasApiKey: false, hasMonidApiKey: false, bindingAvailable: false }),
  );
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasMonidApiKey, setHasMonidApiKey] = useState(false);
  const [bindingAvailable, setBindingAvailable] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [monidKey, setMonidKey] = useState('');
  const [clearMonidKey, setClearMonidKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useDocumentTitle('AI 设置', settings.site.name);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<AiSettingsView>('/ai/settings');
        if (cancelled) return;
        setForm(toForm(data));
        setHasApiKey(data.hasApiKey);
        setHasMonidApiKey(data.hasMonidApiKey);
        setBindingAvailable(data.bindingAvailable);
      } catch (err) {
        if (!cancelled) toastError(err instanceof Error ? err.message : '加载 AI 设置失败');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toastError]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isCloudflare = form.provider === 'cloudflare';
  const keyConfigured = hasApiKey && !clearKey;
  const monidKeyConfigured = hasMonidApiKey && !clearMonidKey;
  const providerUsable = isCloudflare ? bindingAvailable : keyConfigured;

  const fetchModels = async (silent = false) => {
    setModelsLoading(true);
    try {
      const { data } = await api.post<{ models: Array<{ id: string; label: string }> }>('/ai/models', {
        provider: form.provider,
        baseUrl: isCloudflare ? undefined : form.baseUrl,
      });
      setModels(data.models);
      setForm((prev) => (prev.model ? prev : { ...prev, model: data.models[0]?.id ?? '' }));
      if (!silent) success(`已获取 ${data.models.length} 个模型`);
    } catch (err) {
      setModels([]);
      if (!silent) toastError(err instanceof Error ? err.message : '获取模型列表失败');
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (ready && providerUsable) void fetchModels(true);
    // Only re-run when the provider first becomes usable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, providerUsable]);

  const applyProvider = (value: AiProvider) => {
    const preset = PROVIDERS.find((p) => p.value === value);
    setModels([]);
    setForm((prev) => ({
      ...prev,
      provider: value,
      baseUrl: preset ? preset.baseUrl : prev.baseUrl,
      model: preset && preset.model ? preset.model : prev.model,
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { ...form };
      if (clearKey) patch['clearApiKey'] = true;
      else if (apiKey.trim() !== '') patch['apiKey'] = apiKey.trim();
      if (clearMonidKey) patch['clearMonidApiKey'] = true;
      else if (monidKey.trim() !== '') patch['monidApiKey'] = monidKey.trim();
      const { data } = await api.patch<AiSettingsView>('/ai/settings', patch);
      setForm(toForm(data));
      setHasApiKey(data.hasApiKey);
      setHasMonidApiKey(data.hasMonidApiKey);
      setBindingAvailable(data.bindingAvailable);
      setApiKey('');
      setClearKey(false);
      setMonidKey('');
      setClearMonidKey(false);
      success('AI 设置已保存');
      window.dispatchEvent(new Event('edgeblog:ai-settings-changed'));
      if (data.ready) void fetchModels(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    setForm(defaultsForm({ hasApiKey, hasMonidApiKey, bindingAvailable }));
    success('已载入默认值，别忘了保存');
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post<{ text: string }>('/ai/generate', {
        mode: 'excerpt',
        title: '连通性测试',
        contentMd: '这是一段用于测试 AI 连接的示例文本。',
      });
      setTestResult(data.text);
      success('AI 连接正常');
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
          <h1 className="text-xl font-bold tracking-tight text-fg">AI 设置</h1>
          <p className="mt-1 text-sm text-muted">
            默认使用 Cloudflare Workers AI，也可接入任意 OpenAI 兼容服务；接口密钥只保存在服务端
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={restoreDefaults}>
            <Icon name="close" size={16} /> 恢复默认值
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            <Icon name="save" size={16} /> 保存
          </Button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="启用与连通性"
          description="关闭后，文章编辑器和后台浮动助手都不会出现 AI 入口"
          icon="sparkles"
        >
          <Switch
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            label="启用 AI 辅助"
            description="允许生成摘要 / 正文，并开启后台 AI 助手"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={testing}
              disabled={!providerUsable || !form.enabled}
              onClick={() => void testConnection()}
            >
              <Icon name="zap" size={15} /> 测试连接
            </Button>
            <span className="text-xs text-muted">
              {isCloudflare
                ? bindingAvailable
                  ? 'Workers AI 绑定可用'
                  : '未检测到 Workers AI 绑定'
                : keyConfigured
                  ? '已配置 API Key'
                  : '尚未配置 API Key'}
            </span>
          </div>
          {testResult && (
            <div className="rounded-xl bg-surface-2/60 p-3 text-xs leading-relaxed text-muted">
              {testResult}
            </div>
          )}
        </Section>

        <Section
          title="服务商"
          description="默认内置 Workers AI；其他服务需兼容 /chat/completions 接口"
          icon="globe"
        >
          <Select label="服务商" value={form.provider} onChange={(e) => applyProvider(e.target.value as AiProvider)}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>

          {isCloudflare ? (
            <div
              className={cn(
                'rounded-xl border p-3 text-xs leading-relaxed',
                bindingAvailable
                  ? 'border-brand/30 bg-brand/5 text-muted'
                  : 'border-danger/30 bg-danger/5 text-danger',
              )}
            >
              {bindingAvailable
                ? '已检测到 AI 绑定（wrangler.toml 中的 [ai] binding = "AI"），无需 API Key。Workers AI 会按 Cloudflare 账户的免费额度/用量计费。'
                : '未检测到 AI 绑定。请在 wrangler.toml 中添加 [ai] binding = "AI"，或在 Pages 控制台的 Bindings 中配置 Workers AI，然后重新部署。'}
            </div>
          ) : (
            <>
              <Input
                label="接口地址（Base URL）"
                value={form.baseUrl}
                onChange={(e) => set('baseUrl', e.target.value)}
                placeholder="留空使用服务商默认地址"
                hint="形如 https://api.openai.com/v1，会自动拼接 /chat/completions"
              />
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">模型名称</span>
                  <button
                    type="button"
                    onClick={() => void fetchModels()}
                    disabled={modelsLoading || !keyConfigured}
                    title={keyConfigured ? '从服务商获取可用模型' : '请先填写并保存 API Key'}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-opacity hover:opacity-80 disabled:opacity-60"
                  >
                    <Icon name="refresh" size={13} className={modelsLoading ? 'animate-spin' : undefined} />
                    {modelsLoading ? '获取中…' : '获取模型'}
                  </button>
                </div>
                <ComboBox
                  value={form.model}
                  onChange={(value) => set('model', value)}
                  options={models.map((m) => ({ value: m.id, label: m.label, hint: m.id === m.label ? undefined : m.id }))}
                  placeholder="例如 gpt-4o-mini"
                  emptyText="没有匹配的模型，可直接输入完整 ID"
                />
                <p className="text-xs text-faint">
                  {models.length > 0
                    ? `共 ${models.length} 个可选模型，点击输入框展开列表，也可手动输入模型 ID`
                    : keyConfigured
                      ? '可直接手动输入模型 ID，或点击「获取模型」'
                      : '保存 API Key 后会自动获取可用模型'}
                </p>
              </div>
            </>
          )}

          {isCloudflare && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-fg">模型名称</span>
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  disabled={modelsLoading || !bindingAvailable}
                  title={bindingAvailable ? '获取 Workers AI 文本生成模型' : '需要 Workers AI 绑定'}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-opacity hover:opacity-80 disabled:opacity-60"
                >
                  <Icon name="refresh" size={13} className={modelsLoading ? 'animate-spin' : undefined} />
                  {modelsLoading ? '获取中…' : '获取模型'}
                </button>
              </div>
              <ComboBox
                value={form.model}
                onChange={(value) => set('model', value)}
                options={models.map((m) => ({ value: m.id, label: m.label, hint: m.id === m.label ? undefined : m.id }))}
                placeholder="@cf/zai-org/glm-4.7-flash"
                emptyText="没有匹配的模型，可直接输入完整 ID"
              />
              <p className="text-xs text-faint">
                {models.length > 0
                  ? `共 ${models.length} 个可选模型，点击输入框展开列表，也可手动输入模型 ID`
                  : '默认 @cf/zai-org/glm-4.7-flash，支持工具调用'}
              </p>
            </div>
          )}

        </Section>

        {!isCloudflare && (
          <Section title="API 密钥" description="仅存储于服务端，前端只显示是否已配置" icon="lock">
            <Input
              label="API Key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (e.target.value) setClearKey(false);
              }}
              placeholder={keyConfigured ? '留空表示保持不变' : '粘贴你的 API Key'}
              autoComplete="off"
              disabled={clearKey}
            />
            {hasApiKey && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted">{clearKey ? '保存后将清除已存的 Key' : '已保存一个 Key'}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setClearKey((v) => !v);
                    setApiKey('');
                  }}
                >
                  {clearKey ? '取消清除' : '清除'}
                </Button>
              </div>
            )}
          </Section>
        )}

        <Section
          title="联网搜索"
          description="后台助手的 web_search 通过 Monid 调用 TinyFish 免费网页搜索；失败时回退 Cloudflare"
          icon="search"
        >
          <Input
            label="Monid API Key"
            type="password"
            value={monidKey}
            onChange={(e) => {
              setMonidKey(e.target.value);
              if (e.target.value) setClearMonidKey(false);
            }}
            placeholder={monidKeyConfigured ? '留空表示保持不变' : '粘贴 monid_live_… 形式的 Key'}
            hint="通过 api.monid.ai 的免费 TinyFish 网页搜索取回结果；Key 只保存在服务端，不会下发给公开设置。留空则只走 Cloudflare 兜底（若已配置）。"
            autoComplete="off"
            disabled={clearMonidKey}
          />
          {hasMonidApiKey && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {clearMonidKey ? '保存后将清除已存的 Monid Key' : '已保存一个 Monid Key'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClearMonidKey((v) => !v);
                  setMonidKey('');
                }}
              >
                {clearMonidKey ? '取消清除' : '清除'}
              </Button>
            </div>
          )}
        </Section>

        <Section title="生成参数" description="控制模型输出长度与随机性" icon="settings">
          <Input
            label="温度（0–2）"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={String(form.temperature)}
            onChange={(e) => set('temperature', Number(e.target.value))}
            hint="数值越低越稳定，越高越有创造性"
          />
          <Input
            label="最大 Tokens"
            type="number"
            min={64}
            max={32000}
            step={64}
            value={String(form.maxTokens)}
            onChange={(e) => set('maxTokens', Number(e.target.value))}
          />
        </Section>

        <Section
          title="提示词"
          description="自定义两种生成任务的系统提示词"
          icon="fileText"
          className="lg:col-span-2"
        >
          <Textarea
            label="生成摘要"
            value={form.excerptPrompt}
            onChange={(e) => set('excerptPrompt', e.target.value)}
            rows={4}
          />
          <Textarea
            label="生成正文"
            value={form.contentPrompt}
            onChange={(e) => set('contentPrompt', e.target.value)}
            rows={5}
          />
        </Section>
      </div>
    </div>
  );
}
