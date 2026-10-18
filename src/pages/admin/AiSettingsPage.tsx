import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AiSettingsView, AiProvider } from '@shared/types';
import { AI_DEFAULTS } from '@shared/settings-defaults';
import { api } from '../../lib/api';
import { useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { Card } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/icons';
import { cn } from '../../lib/utils';

const PROVIDERS: Array<{ value: AiProvider; label: string; baseUrl: string; model: string }> = [
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { value: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];

type FormState = Omit<AiSettingsView, 'hasApiKey'>;

function toForm(view: AiSettingsView): FormState {
  const { hasApiKey, ...rest } = view;
  return rest;
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

  const [form, setForm] = useState<FormState>(() => toForm({ ...AI_DEFAULTS, hasApiKey: false }));
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
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

  const fetchModels = async (silent = false) => {
    setModelsLoading(true);
    try {
      const { data } = await api.post<{ models: string[] }>('/ai/models', {
        provider: form.provider,
        baseUrl: form.baseUrl,
      });
      setModels(data.models);
      setForm((prev) => (prev.model ? prev : { ...prev, model: data.models[0] ?? '' }));
      if (!silent) success(`已获取 ${data.models.length} 个模型`);
    } catch (err) {
      setModels([]);
      if (!silent) toastError(err instanceof Error ? err.message : '获取模型列表失败');
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (ready && hasApiKey) void fetchModels(true);
    // Only re-run when a key first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasApiKey]);

  const modelOptions = useMemo(() => {
    const list = [...models];
    if (form.model && !list.includes(form.model)) list.unshift(form.model);
    return list;
  }, [models, form.model]);

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
      const { data } = await api.patch<AiSettingsView>('/ai/settings', patch);
      setForm(toForm(data));
      setHasApiKey(data.hasApiKey);
      setApiKey('');
      setClearKey(false);
      success('AI 设置已保存');
      if (data.hasApiKey) void fetchModels(true);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    setForm(toForm({ ...AI_DEFAULTS, hasApiKey }));
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

  const keyConfigured = hasApiKey && !clearKey;

  return (
    <div className="pb-16">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">AI 设置</h1>
          <p className="mt-1 text-sm text-muted">配置用于「生成摘要 / 生成正文」的大模型服务，接口密钥只保存在服务端</p>
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
        <Section title="启用与连通性" description="关闭后，文章编辑器不会显示 AI 生成按钮" icon="sparkles">
          <Switch
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            label="启用 AI 辅助写作"
            description="允许在文章编辑页生成摘要与正文"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={testing}
              disabled={!keyConfigured || !form.enabled}
              onClick={() => void testConnection()}
            >
              <Icon name="zap" size={15} /> 测试连接
            </Button>
            <span className="text-xs text-muted">
              {keyConfigured ? '已配置 API Key' : '尚未配置 API Key'}
            </span>
          </div>
          {testResult && (
            <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-xs leading-relaxed text-muted">
              {testResult}
            </div>
          )}
        </Section>

        <Section title="服务商" description="支持任意 OpenAI 兼容的 /chat/completions 接口" icon="globe">
          <Select label="服务商" value={form.provider} onChange={(e) => applyProvider(e.target.value as AiProvider)}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
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
                disabled={modelsLoading || !hasApiKey}
                title={hasApiKey ? '从服务商获取可用模型' : '请先填写并保存 API Key'}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-opacity hover:opacity-80 disabled:opacity-60"
              >
                <Icon name="refresh" size={13} className={modelsLoading ? 'animate-spin' : undefined} />
                {modelsLoading ? '获取中…' : '获取模型'}
              </button>
            </div>
            <Select value={form.model} onChange={(e) => set('model', e.target.value)}>
              {modelOptions.length === 0 ? (
                <option value={form.model}>{form.model || '尚未获取到模型'}</option>
              ) : (
                modelOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </Select>
            <p className="text-xs text-faint">
              {models.length > 0
                ? `共 ${models.length} 个可选模型`
                : hasApiKey
                  ? '尚未获取到模型列表，可点击「获取模型」重试'
                  : '保存 API Key 后会自动获取可用模型'}
            </p>
          </div>
        </Section>

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
