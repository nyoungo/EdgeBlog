import { useEffect, useState, type ReactNode } from 'react';
import type {
  FeatureFlags,
  MusicPlayMode,
  MusicTrack,
  NavItem,
  PublicSettings,
  SiteSettings,
  SocialLink,
  ThemeSettings,
} from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { Card } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { CODE_THEMES } from '../../lib/code-themes';
import { BACKGROUND_LAYOUT } from '../../lib/theme';
import { api } from '../../lib/api';
import { useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

type Namespace = 'site' | 'theme' | 'layout' | 'navigation' | 'social' | 'features' | 'comments' | 'pages' | 'advanced' | 'music';

const TABS: Array<{ id: Namespace; label: string; icon: IconName }> = [
  { id: 'theme', label: '主题', icon: 'palette' },
  { id: 'layout', label: '布局', icon: 'dashboard' },
  { id: 'navigation', label: '导航', icon: 'globe' },
  { id: 'site', label: '站点', icon: 'home' },
  { id: 'social', label: '社交', icon: 'link' },
  { id: 'features', label: '功能', icon: 'settings' },
  { id: 'comments', label: '评论', icon: 'message' },
  { id: 'pages', label: '页面', icon: 'fileText' },
  { id: 'music', label: '音乐', icon: 'music' },
  { id: 'advanced', label: '高级', icon: 'sparkles' },
];

const PRESETS = [
  { value: 'ink', label: '墨白', color: '#6366f1' },
  { value: 'midnight', label: '暗夜', color: '#3b82f6' },
  { value: 'solar', label: '暖阳', color: '#ea580c' },
  { value: 'seasaltt', label: '海盐', color: '#0d9488' },
  { value: 'forest', label: '森绿', color: '#16a34a' },
  { value: 'cyber', label: '赛博', color: '#d946ef' },
] as const;

const FEATURE_LABELS: Record<keyof FeatureFlags, { label: string; description: string }> = {
  comments: { label: '评论系统', description: '允许访客在文章下留言' },
  search: { label: '站内搜索', description: '显示搜索入口与搜索页' },
  rss: { label: 'RSS 订阅', description: '生成 /rss.xml 订阅源' },
  views: { label: '浏览量统计', description: '记录并显示文章浏览量' },
  viewTransitions: { label: '视图过渡动画', description: '使用 View Transitions API' },
  toc: { label: '文章目录', description: '在长文旁显示目录' },
  backToTop: { label: '返回顶部', description: '显示悬浮返回顶部按钮' },
  newsletter: { label: '订阅模块', description: '首页显示邮箱订阅模块' },
  relatedPosts: { label: '相关文章', description: '文章底部显示相关内容' },
  prevNext: { label: '上一篇 / 下一篇', description: '文章底部显示相邻文章导航' },
};

const MODULE_LABELS: Record<string, string> = {
  hero: '欢迎区',
  latest: '最新文章',
  featured: '精选',
  tags: '标签云',
  newsletter: '订阅',
};

const BG_LAYOUT_OPTIONS: Array<{ value: ThemeSettings['backgroundLayout']; label: string }> = [
  { value: 'cover', label: '铺满裁剪' },
  { value: 'contain', label: '完整显示' },
  { value: 'center', label: '居中不重复' },
  { value: 'tile', label: '平铺' },
  { value: 'repeat-x', label: '横向平铺' },
  { value: 'repeat-y', label: '纵向平铺' },
];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === option.value ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function swap<T>(list: T[], i: number, j: number): T[] {
  const next = [...list];
  const a = next[i];
  const b = next[j];
  if (a === undefined || b === undefined) return list;
  next[i] = b;
  next[j] = a;
  return next;
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

/** Label + description on the left, an inline control on the right. */
function Row({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-[7rem]">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Colour swatch + free-text CSS colour, with a clear button. */
function ColorInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={HEX.test(value) ? value : '#6366f1'}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent"
        aria-label="选择颜色"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        wrapperClassName="flex-1"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="清除颜色"
        >
          <Icon name="close" size={15} />
        </button>
      )}
    </div>
  );
}

export function AppearancePage() {
  const { settings, loading, setSettings, reload } = useSettings();
  const { success, error: toastError } = useToast();

  const [draft, setDraft] = useState<PublicSettings>(settings);
  const [tab, setTab] = useState<Namespace>('theme');
  const [dirty, setDirty] = useState<Set<Namespace>>(new Set());
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useDocumentTitle('外观设置', settings.site.name);

  // Seed the draft once the server config has loaded.
  useEffect(() => {
    if (!loading && !ready) {
      setDraft(settings);
      setReady(true);
    }
  }, [loading, ready, settings]);

  const update = <K extends Namespace>(ns: K, value: PublicSettings[K]) => {
    const next = { ...draft, [ns]: value } as PublicSettings;
    setDraft(next);
    setSettings(next); // live preview
    setDirty((prev) => new Set(prev).add(ns));
  };

  const save = async () => {
    if (dirty.size === 0) {
      success('没有需要保存的修改');
      return;
    }
    setSaving(true);
    try {
      for (const ns of dirty) {
        await api.patch(`/settings/${ns}`, draft[ns]);
      }
      success('设置已保存');
      setDirty(new Set());
      await reload();
      setReady(false);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resetTab = async () => {
    try {
      const { data } = await api.post<PublicSettings>('/settings/reset', { namespace: tab });
      setDraft(data);
      setSettings(data);
      setDirty(new Set());
      success('已恢复该页默认设置');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '恢复失败');
    }
  };

  const theme = draft.theme;
  const layout = draft.layout;
  const site = draft.site;
  const hero = layout.hero;
  const header = layout.header;
  const features = draft.features;
  const bgPreview = BACKGROUND_LAYOUT[theme.backgroundLayout] ?? BACKGROUND_LAYOUT.cover;

  const setTheme = (patch: Partial<ThemeSettings>) => update('theme', { ...theme, ...patch });
  const setLayout = (patch: Partial<typeof layout>) => update('layout', { ...layout, ...patch });
  const setHero = (patch: Partial<typeof hero>) => setLayout({ hero: { ...hero, ...patch } });
  const setHeader = (patch: Partial<typeof header>) => setLayout({ header: { ...header, ...patch } });
  const setSite = (patch: Partial<SiteSettings>) => update('site', { ...site, ...patch });
  const setMusic = (patch: Partial<typeof draft.music>) => update('music', { ...draft.music, ...patch });

  const updateTrack = (index: number, patch: Partial<MusicTrack>) =>
    setMusic({ playlist: draft.music.playlist.map((t, i) => (i === index ? { ...t, ...patch } : t)) });

  if (!ready) {
    return <div className="py-20 text-center text-sm text-faint">载入中…</div>;
  }

  return (
    <div className="pb-16">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">外观设置</h1>
          <p className="mt-1 text-sm text-muted">可视化定制站点外观与行为，修改实时预览、保存后永久生效</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty.size > 0 && (
            <span className="hidden items-center gap-1.5 text-xs text-warning sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              有未保存的修改
            </span>
          )}
          <Button variant="ghost" onClick={() => void resetTab()}>
            <Icon name="close" size={16} /> 恢复本页默认
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={dirty.size === 0}>
            <Icon name="save" size={16} /> 保存修改
          </Button>
        </div>
      </header>

      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'relative flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {dirty.has(t.id) && (
              <span
                className={cn('h-1.5 w-1.5 rounded-full', tab === t.id ? 'bg-brand-fg' : 'bg-warning')}
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'theme' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="配色" description="选择一个基础色板，可再自定义主色" icon="palette">
            <div className="grid grid-cols-3 gap-2.5">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={theme.preset === p.value}
                  onClick={() => setTheme({ preset: p.value })}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors',
                    theme.preset === p.value ? 'border-brand bg-brand/5' : 'border-border hover:bg-surface-2',
                  )}
                >
                  <span className="h-8 w-8 rounded-full" style={{ background: p.color }} />
                  <span className="text-xs font-medium text-fg">{p.label}</span>
                </button>
              ))}
            </div>
            <Row label="默认模式">
              <Segmented
                value={theme.mode}
                onChange={(mode) => setTheme({ mode })}
                options={[
                  { value: 'light', label: '明亮' },
                  { value: 'dark', label: '暗黑' },
                  { value: 'system', label: '跟随系统' },
                ]}
              />
            </Row>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-fg">自定义主色</span>
              <ColorInput
                value={theme.primaryColor}
                onChange={(primaryColor) => setTheme({ primaryColor })}
                placeholder="留空使用预设色"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-fg">全局背景色</span>
              <ColorInput
                value={theme.backgroundColor}
                onChange={(backgroundColor) => setTheme({ backgroundColor })}
                placeholder="留空使用预设背景"
              />
              <p className="text-xs text-muted">仅影响浅色模式的页面背景；暗色模式仍使用预设深色背景。</p>
            </div>
          </Section>

          <Section title="排版" description="字体、字号、行高与圆角" icon="fileText">
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="正文字体"
                value={theme.fontBody}
                onChange={(e) => setTheme({ fontBody: e.target.value as ThemeSettings['fontBody'] })}
              >
                <option value="sans">无衬线</option>
                <option value="serif">衬线</option>
              </Select>
              <Select
                label="标题字体"
                value={theme.fontHeading}
                onChange={(e) => setTheme({ fontHeading: e.target.value as ThemeSettings['fontHeading'] })}
              >
                <option value="sans">无衬线</option>
                <option value="serif">衬线</option>
              </Select>
            </div>
            <Row label="字号">
              <Segmented
                value={theme.fontScale}
                onChange={(fontScale) => setTheme({ fontScale })}
                options={[
                  { value: 'sm', label: '小' },
                  { value: 'md', label: '中' },
                  { value: 'lg', label: '大' },
                ]}
              />
            </Row>
            <Row label="行高">
              <Segmented
                value={theme.lineHeight}
                onChange={(lineHeight) => setTheme({ lineHeight })}
                options={[
                  { value: 'compact', label: '紧凑' },
                  { value: 'normal', label: '标准' },
                  { value: 'relaxed', label: '宽松' },
                ]}
              />
            </Row>
            <Row label="圆角">
              <Segmented
                value={theme.radius}
                onChange={(radius) => setTheme({ radius })}
                options={[
                  { value: 'none', label: '直角' },
                  { value: 'sm', label: '小' },
                  { value: 'md', label: '中' },
                  { value: 'lg', label: '大' },
                ]}
              />
            </Row>
            <Input
              label="内容最大宽度"
              value={theme.maxWidth}
              onChange={(e) => setTheme({ maxWidth: e.target.value })}
              placeholder="72ch"
              hint="支持 ch / px / rem，如 72ch 或 760px"
            />
            <Select
              label="代码高亮主题"
              value={theme.codeTheme}
              onChange={(e) => setTheme({ codeTheme: e.target.value })}
            >
              {Object.entries(CODE_THEMES).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Section>

          <Section
            title="背景图"
            description="全站背景图片，支持多种布局方式；留空则不显示"
            icon="image"
            className="lg:col-span-2"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Input
                  label="图片地址"
                  value={theme.backgroundImage}
                  onChange={(e) => setTheme({ backgroundImage: e.target.value })}
                  placeholder="https://example.com/bg.jpg"
                  hint="支持外链或 /media/… 相对地址"
                />
                {theme.backgroundImage && (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
                    <span
                      aria-hidden="true"
                      className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-border bg-surface"
                      style={{
                        backgroundImage: `url("${theme.backgroundImage.replace(/"/g, '%22')}")`,
                        backgroundSize: bgPreview.size,
                        backgroundRepeat: bgPreview.repeat,
                        backgroundPosition: bgPreview.position,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0"
                        style={{ background: `rgb(var(--c-bg) / ${theme.backgroundScrim})` }}
                      />
                    </span>
                    <div className="min-w-0 flex-1 text-xs text-muted">
                      <p className="font-medium text-fg">预览</p>
                      <p className="mt-0.5 break-all">{theme.backgroundImage}</p>
                      <button
                        type="button"
                        onClick={() => setTheme({ backgroundImage: '' })}
                        className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted transition-colors hover:bg-surface hover:text-fg"
                      >
                        <Icon name="close" size={13} /> 清除背景图
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium text-fg">布局方式</span>
                <Segmented
                  value={theme.backgroundLayout}
                  onChange={(backgroundLayout) => setTheme({ backgroundLayout })}
                  options={BG_LAYOUT_OPTIONS}
                />
                <p className="text-xs text-muted">
                  「铺满裁剪」自动缩放填满屏幕；「平铺」适合纹理/花纹图，按原始尺寸重复。
                </p>
              </div>

              <Row label="滚动方式" description="固定 = 背景不动，内容滚动（类视差）">
                <Segmented
                  value={theme.backgroundAttachment}
                  onChange={(backgroundAttachment) => setTheme({ backgroundAttachment })}
                  options={[
                    { value: 'fixed', label: '固定' },
                    { value: 'scroll', label: '跟随滚动' },
                  ]}
                />
              </Row>
              <Input
                label="遮罩浓度（0–0.9）"
                type="number"
                min={0}
                max={0.9}
                step={0.05}
                value={theme.backgroundScrim}
                onChange={(e) =>
                  setTheme({ backgroundScrim: Math.min(0.9, Math.max(0, Number(e.target.value) || 0)) })
                }
                hint="用主题背景色压暗/提亮图片，保证文字可读"
              />
            </div>
          </Section>
        </div>
      )}

      {tab === 'layout' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="欢迎区域（Hero）"
            description="首页顶部欢迎区的尺寸、背景、遮罩与文字颜色"
            icon="image"
            className="lg:col-span-2"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3 sm:col-span-2">
                <div>
                  <div className="text-sm font-medium text-fg">铺满屏幕</div>
                  <p className="mt-0.5 text-xs text-muted">全宽并占满整个视口高度；开启后将忽略下方「宽度」与「高度」</p>
                </div>
                <Switch checked={hero.fullScreen} onChange={(fullScreen) => setHero({ fullScreen })} />
              </div>

              {hero.fullScreen ? (
                <div className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-muted sm:col-span-2">
                  <Icon name="info" size={15} className="shrink-0 text-brand" />
                  当前为「铺满屏幕」模式，宽度与高度已锁定。
                </div>
              ) : (
                <>
                  <Row label="宽度">
                    <Segmented
                      value={hero.width}
                      onChange={(width) => setHero({ width })}
                      options={[
                        { value: 'contained', label: '标准' },
                        { value: 'narrow', label: '窄' },
                        { value: 'full', label: '全宽' },
                      ]}
                    />
                  </Row>
                  <Input
                    label="高度（如 360px / 60vh，留空自适应）"
                    value={hero.height}
                    onChange={(e) => setHero({ height: e.target.value })}
                    placeholder="auto"
                  />
                </>
              )}

              <Row label="对齐">
                <Segmented
                  value={hero.align}
                  onChange={(align) => setHero({ align })}
                  options={[
                    { value: 'left', label: '居左' },
                    { value: 'center', label: '居中' },
                  ]}
                />
              </Row>
              <Input
                label="背景颜色 / 渐变"
                value={hero.background}
                onChange={(e) => setHero({ background: e.target.value })}
                placeholder="#0f172a 或 linear-gradient(...)"
              />
              <Input
                label="背景图片 URL"
                value={hero.backgroundImage}
                onChange={(e) => setHero({ backgroundImage: e.target.value })}
                placeholder="https://…"
                wrapperClassName="sm:col-span-2"
              />
              <Input
                label="亮色主题遮罩（0–1）"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={hero.overlayLight}
                onChange={(e) => setHero({ overlayLight: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
              />
              <Input
                label="暗色主题遮罩（0–1）"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={hero.overlayDark}
                onChange={(e) => setHero({ overlayDark: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
              />
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-fg">标题颜色</span>
                <ColorInput
                  value={hero.textColor}
                  onChange={(textColor) => setHero({ textColor })}
                  placeholder="留空跟随主题"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-fg">描述颜色</span>
                <ColorInput
                  value={hero.textMutedColor}
                  onChange={(textMutedColor) => setHero({ textMutedColor })}
                  placeholder="留空跟随主题"
                />
              </div>
            </div>
          </Section>

          <Section title="首页模块" description="顺序即为显示顺序，开关控制显示" icon="dashboard">
            <ul className="space-y-2">
              {layout.homeModules.map((module, index) => (
                <li key={module.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <Icon name="drag" size={15} className="shrink-0 text-faint" />
                  <span className="flex-1 text-sm font-medium text-fg">{MODULE_LABELS[module.id] ?? module.id}</span>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => setLayout({ homeModules: swap(layout.homeModules, index - 1, index) })}
                    className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 disabled:opacity-30"
                    aria-label="上移"
                  >
                    <Icon name="chevronDown" size={15} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    disabled={index === layout.homeModules.length - 1}
                    onClick={() => setLayout({ homeModules: swap(layout.homeModules, index, index + 1) })}
                    className="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-surface-2 disabled:opacity-30"
                    aria-label="下移"
                  >
                    <Icon name="chevronDown" size={15} />
                  </button>
                  <Switch
                    checked={module.enabled}
                    onChange={(enabled) => {
                      const next = layout.homeModules.map((m) => (m.id === module.id ? { ...m, enabled } : m));
                      setLayout({ homeModules: next });
                    }}
                  />
                </li>
              ))}
            </ul>
          </Section>

          <Section title="列表与卡片" description="文章列表的展示方式" icon="list">
            <Row label="卡片风格">
              <Segmented
                value={layout.cardStyle}
                onChange={(cardStyle) => setLayout({ cardStyle })}
                options={[
                  { value: 'magazine', label: '杂志' },
                  { value: 'minimal', label: '极简' },
                  { value: 'grid', label: '网格' },
                  { value: 'overlay', label: '浮层' },
                  { value: 'compact', label: '紧凑' },
                ]}
              />
            </Row>
            <Row label="尺寸" description="影响内边距、字号与列表密度">
              <Segmented
                value={layout.cardSize}
                onChange={(cardSize) => setLayout({ cardSize })}
                options={[
                  { value: 'lg', label: '大' },
                  { value: 'md', label: '中' },
                  { value: 'sm', label: '小' },
                ]}
              />
            </Row>
            <Row label="模糊" description="卡片毛玻璃效果（极简风格不适用）">
              <Segmented
                value={layout.cardBlur}
                onChange={(cardBlur) => setLayout({ cardBlur })}
                options={[
                  { value: 'none', label: '无' },
                  { value: 'sm', label: '弱' },
                  { value: 'md', label: '中' },
                  { value: 'lg', label: '强' },
                ]}
              />
            </Row>
            <Row label="侧边栏">
              <Segmented
                value={layout.sidebar}
                onChange={(sidebar) => setLayout({ sidebar })}
                options={[
                  { value: 'left', label: '居左' },
                  { value: 'right', label: '居右' },
                  { value: 'none', label: '无' },
                ]}
              />
            </Row>
            <Input
              label="每页文章数"
              type="number"
              min={1}
              max={50}
              value={layout.postsPerPage}
              onChange={(e) => setLayout({ postsPerPage: Number(e.target.value) || 1 })}
            />
          </Section>
        </div>
      )}

      {tab === 'navigation' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="导航栏" description="顶部导航栏的位置、样式与背景" icon="globe">
            <Row label="位置" description="「左侧」在桌面端显示竖向侧边栏，移动端仍用顶部栏">
              <Segmented
                value={header.position}
                onChange={(position) => setHeader({ position })}
                options={[
                  { value: 'static', label: '跟随页面' },
                  { value: 'sticky', label: '吸顶' },
                  { value: 'fixed', label: '固定' },
                  { value: 'left', label: '左侧' },
                ]}
              />
            </Row>
            <Row label="样式">
              <Segmented
                value={header.style}
                onChange={(style) => setHeader({ style })}
                options={[
                  { value: 'default', label: '默认' },
                  { value: 'minimal', label: '极简' },
                  { value: 'pill', label: '胶囊' },
                ]}
              />
            </Row>
            <Row label="背景">
              <Segmented
                value={header.background}
                onChange={(background) => setHeader({ background })}
                options={[
                  { value: 'solid', label: '纯色' },
                  { value: 'glass', label: '玻璃' },
                  { value: 'transparent', label: '透明' },
                ]}
              />
            </Row>
            <Row label="对齐">
              <Segmented
                value={header.align}
                onChange={(align) => setHeader({ align })}
                options={[
                  { value: 'left', label: '居左' },
                  { value: 'center', label: '居中' },
                  { value: 'right', label: '居右' },
                ]}
              />
            </Row>
            <Input
              label="高度（如 64px）"
              value={header.height}
              onChange={(e) => setHeader({ height: e.target.value })}
              placeholder="64px"
            />
            <Switch
              checked={header.transparentOnTop}
              onChange={(transparentOnTop) => setHeader({ transparentOnTop })}
              label="顶部透明"
              description="未滚动时透明，滚动后显示背景"
              className="rounded-lg border border-border p-3"
            />
          </Section>

          <Section title="导航菜单" description="顺序即为显示顺序" icon="list">
            <div className="space-y-2">
              {draft.navigation.map((item: NavItem, i) => (
                <div key={item.id} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex gap-2">
                    <Input
                      value={item.label}
                      placeholder="名称"
                      wrapperClassName="w-28"
                      onChange={(e) => update('navigation', draft.navigation.map((n, idx) => (idx === i ? { ...n, label: e.target.value } : n)))}
                    />
                    <Input
                      value={item.href}
                      placeholder="/path 或 https://…"
                      wrapperClassName="flex-1"
                      onChange={(e) => update('navigation', draft.navigation.map((n, idx) => (idx === i ? { ...n, href: e.target.value } : n)))}
                    />
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => update('navigation', swap(draft.navigation, i - 1, i))}
                      className="flex h-10 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30"
                      aria-label="上移"
                    >
                      <Icon name="chevronDown" size={15} className="rotate-180" />
                    </button>
                    <button
                      type="button"
                      onClick={() => update('navigation', draft.navigation.filter((_, idx) => idx !== i))}
                      className="flex h-10 w-9 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label="删除"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="flex gap-4 pl-1">
                    <Switch
                      checked={item.external}
                      onChange={(external) => update('navigation', draft.navigation.map((n, idx) => (idx === i ? { ...n, external } : n)))}
                      label="外部链接"
                    />
                    <Switch
                      checked={item.newTab}
                      onChange={(newTab) => update('navigation', draft.navigation.map((n, idx) => (idx === i ? { ...n, newTab } : n)))}
                      label="新窗口打开"
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                update('navigation', [
                  ...draft.navigation,
                  { id: `nav-${Date.now().toString(36)}`, label: '新页面', href: '/', external: false, newTab: false },
                ])
              }
            >
              <Icon name="plus" size={16} /> 添加导航项
            </Button>
          </Section>
        </div>
      )}

      {tab === 'site' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="站点信息" description="名称、标语与描述" icon="home">
            <Input label="站点名称" value={site.name} onChange={(e) => setSite({ name: e.target.value })} />
            <Input label="标语" value={site.tagline} onChange={(e) => setSite({ tagline: e.target.value })} />
            <Textarea label="站点描述" value={site.description} onChange={(e) => setSite({ description: e.target.value })} rows={3} />
            <Input label="语言（locale）" value={site.locale} onChange={(e) => setSite({ locale: e.target.value })} placeholder="zh-CN" />
          </Section>
          <Section title="Logo 与页脚" description="品牌标识与底部内容" icon="image">
            <Row label="Logo 类型">
              <Segmented
                value={site.logo.type}
                onChange={(type) => setSite({ logo: { ...site.logo, type } })}
                options={[
                  { value: 'text', label: '文字' },
                  { value: 'image', label: '图片' },
                ]}
              />
            </Row>
            {site.logo.type === 'text' ? (
              <Input label="Logo 文字" value={site.logo.text} onChange={(e) => setSite({ logo: { ...site.logo, text: e.target.value } })} />
            ) : (
              <Input label="Logo 图片地址" value={site.logo.imageUrl} onChange={(e) => setSite({ logo: { ...site.logo, imageUrl: e.target.value } })} />
            )}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-fg">站点图标（favicon）</span>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
                  style={{ background: 'rgb(var(--c-brand))' }}
                >
                  {(site.logo.text || site.name || 'E').slice(0, 1).toUpperCase()}
                </span>
                <Input
                  value={site.favicon}
                  wrapperClassName="flex-1"
                  placeholder="https://example.com/icon.png（留空自动生成）"
                  onChange={(e) => setSite({ favicon: e.target.value })}
                />
                {site.favicon ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSite({ favicon: '' })}>
                    重置
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted">
                留空则自动生成：品牌主色圆角块 + 站点名首字母。也可填图片地址（支持上传到媒体库后的链接）。
              </p>
            </div>
            <Textarea label="页脚版权文字" value={site.footerText} onChange={(e) => setSite({ footerText: e.target.value })} rows={2} />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-fg">页脚链接</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSite({ footerLinks: [...site.footerLinks, { label: '新链接', href: '/' }] })}
                >
                  <Icon name="plus" size={15} /> 添加
                </Button>
              </div>
              {site.footerLinks.map((link, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={link.label}
                    wrapperClassName="w-28"
                    onChange={(e) => {
                      const next = site.footerLinks.map((l, idx) => (idx === i ? { ...l, label: e.target.value } : l));
                      setSite({ footerLinks: next });
                    }}
                  />
                  <Input
                    value={link.href}
                    wrapperClassName="flex-1"
                    onChange={(e) => {
                      const next = site.footerLinks.map((l, idx) => (idx === i ? { ...l, href: e.target.value } : l));
                      setSite({ footerLinks: next });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setSite({ footerLinks: site.footerLinks.filter((_, idx) => idx !== i) })}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
                    aria-label="删除"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {tab === 'social' && (
        <Section title="社交链接" description="显示在页脚" icon="link">
          <div className="space-y-2">
            {draft.social.map((item: SocialLink, i) => (
              <div key={item.id} className="flex flex-wrap gap-2 rounded-lg border border-border p-3">
                <Select
                  value={item.type}
                  wrapperClassName="w-32"
                  onChange={(e) => update('social', draft.social.map((s, idx) => (idx === i ? { ...s, type: e.target.value as SocialLink['type'] } : s)))}
                >
                  {['github', 'x', 'email', 'rss', 'mastodon', 'bluesky', 'linkedin', 'youtube', 'wechat', 'link'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
                <Input
                  value={item.label}
                  placeholder="名称"
                  wrapperClassName="w-32"
                  onChange={(e) => update('social', draft.social.map((s, idx) => (idx === i ? { ...s, label: e.target.value } : s)))}
                />
                <Input
                  value={item.url}
                  placeholder="https:// 或 mailto:"
                  wrapperClassName="min-w-[12rem] flex-1"
                  onChange={(e) => update('social', draft.social.map((s, idx) => (idx === i ? { ...s, url: e.target.value } : s)))}
                />
                <button
                  type="button"
                  onClick={() => update('social', draft.social.filter((_, idx) => idx !== i))}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
                  aria-label="删除"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              update('social', [...draft.social, { id: `soc-${Date.now().toString(36)}`, type: 'link', label: '新链接', url: 'https://' }])
            }
          >
            <Icon name="plus" size={16} /> 添加社交链接
          </Button>
        </Section>
      )}

      {tab === 'features' && (
        <Section title="功能开关" description="随时开启或关闭站点功能" icon="settings">
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(FEATURE_LABELS) as Array<keyof FeatureFlags>).map((key) => (
              <Switch
                key={key}
                checked={features[key]}
                onChange={(value) => update('features', { ...features, [key]: value })}
                label={FEATURE_LABELS[key].label}
                description={FEATURE_LABELS[key].description}
                className="rounded-lg border border-border p-3"
              />
            ))}
          </div>
        </Section>
      )}

      {tab === 'comments' && (
        <Section title="评论设置" description="审核、频率与长度限制" icon="message">
          <Switch
            checked={draft.comments.requireModeration}
            onChange={(requireModeration) => update('comments', { ...draft.comments, requireModeration })}
            label="评论需要审核"
            description="开启后，新评论需审核通过才显示"
            className="rounded-lg border border-border p-3"
          />
          <Switch
            checked={draft.comments.allowGuests}
            onChange={(allowGuests) => update('comments', { ...draft.comments, allowGuests })}
            label="允许访客评论"
            description="关闭后仅登录用户可评论"
            className="rounded-lg border border-border p-3"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input
              label="最大回复层级"
              type="number"
              min={0}
              max={5}
              value={draft.comments.maxDepth}
              onChange={(e) => update('comments', { ...draft.comments, maxDepth: Number(e.target.value) })}
            />
            <Input
              label="评论间隔（秒）"
              type="number"
              min={5}
              max={3600}
              value={draft.comments.rateLimitSeconds}
              onChange={(e) => update('comments', { ...draft.comments, rateLimitSeconds: Number(e.target.value) })}
            />
            <Input
              label="最短长度"
              type="number"
              min={1}
              max={100}
              value={draft.comments.minLength}
              onChange={(e) => update('comments', { ...draft.comments, minLength: Number(e.target.value) })}
            />
            <Input
              label="最长长度"
              type="number"
              min={10}
              max={10000}
              value={draft.comments.maxLength}
              onChange={(e) => update('comments', { ...draft.comments, maxLength: Number(e.target.value) })}
            />
          </div>
        </Section>
      )}

      {tab === 'pages' && (
        <Section title="关于页" description="使用 Markdown 撰写" icon="fileText">
          <Input
            label="页面标题"
            value={draft.pages.about.title}
            onChange={(e) => update('pages', { about: { ...draft.pages.about, title: e.target.value } })}
          />
          <Textarea
            label="内容（Markdown）"
            value={draft.pages.about.contentMd}
            onChange={(e) => update('pages', { about: { ...draft.pages.about, contentMd: e.target.value } })}
            rows={14}
            className="font-mono text-sm"
          />
        </Section>
      )}

      {tab === 'music' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="音乐播放器" description="基于 XF Music Player 的悬浮播放器，默认关闭，开启后仅在访客前台加载" icon="music">
            <Switch
              checked={draft.music.enabled}
              onChange={(enabled) => setMusic({ enabled })}
              label="启用音乐播放器"
              description="开启后访客页面会出现悬浮播放器（懒加载，不影响首屏）"
              className="rounded-lg border border-border p-3"
            />
            <Row label="界面语言">
              <Segmented
                value={draft.music.language}
                onChange={(language) => setMusic({ language })}
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </Row>
            <Select
              label="播放模式"
              value={draft.music.playMode}
              onChange={(e) => setMusic({ playMode: e.target.value as MusicPlayMode })}
            >
              <option value="order">顺序播放</option>
              <option value="single">单曲循环</option>
              <option value="random">随机播放</option>
            </Select>
          </Section>

          <Section title="数据源" description="云端接口拉取歌单，或使用本地歌单" icon="globe">
            <Row label="数据源">
              <Segmented
                value={draft.music.mode}
                onChange={(mode) => setMusic({ mode })}
                options={[
                  { value: 'cloud', label: '云端接口' },
                  { value: 'local', label: '本地歌单' },
                ]}
              />
            </Row>

            {draft.music.mode === 'cloud' ? (
              <Input
                label="歌单接口 (apiUrl)"
                value={draft.music.apiUrl}
                onChange={(e) => setMusic({ apiUrl: e.target.value })}
                placeholder="https://music.api.xfyun.club/api/v1/music/top?platform=netease&topId=3778678"
                hint="需返回 { code, msg, data: [...] } 结构；播放器将在访客端请求该接口"
              />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">本地歌单</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setMusic({
                        playlist: [
                          ...draft.music.playlist,
                          { id: `track-${Date.now().toString(36)}`, title: '新歌曲', artist: '', cover: '', src: '' },
                        ],
                      })
                    }
                  >
                    <Icon name="plus" size={15} /> 添加
                  </Button>
                </div>
                {draft.music.playlist.length === 0 && <p className="text-xs text-faint">暂无歌曲，点击「添加」。</p>}
                {draft.music.playlist.map((track, i) => (
                  <div key={track.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex gap-2">
                      <Input
                        value={track.title}
                        placeholder="标题"
                        wrapperClassName="flex-1"
                        onChange={(e) => updateTrack(i, { title: e.target.value })}
                      />
                      <Input
                        value={track.artist ?? ''}
                        placeholder="歌手"
                        wrapperClassName="w-32"
                        onChange={(e) => updateTrack(i, { artist: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setMusic({ playlist: draft.music.playlist.filter((_, idx) => idx !== i) })}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
                        aria-label="删除"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                    <Input
                      value={track.src}
                      placeholder="音频地址 https://… 或 /media/…"
                      onChange={(e) => updateTrack(i, { src: e.target.value })}
                    />
                    <Input
                      value={track.cover ?? ''}
                      placeholder="封面地址（可选）"
                      onChange={(e) => updateTrack(i, { cover: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="外观与交互"
            description="主题、尺寸与视觉选项"
            icon="palette"
            className="lg:col-span-2"
          >
            <Select
              label="主题"
              value={draft.music.theme}
              onChange={(e) => setMusic({ theme: e.target.value })}
              hint="无论选哪个主题，播放器强调色都会跟随博客「主题色」；auto-theme 跟随博客亮暗模式。"
            >
              <option value="auto-theme">跟随博客亮暗（auto-theme）</option>
              <option value="xf-original-theme">原始 · 浅色</option>
              <option value="xf-theme">默认</option>
              <option value="xf-dark-theme">暗色</option>
              <option value="xf-orange-theme">橙色</option>
              <option value="xf-pink-theme">粉色</option>
              <option value="xf-sky-theme">天空</option>
              <option value="xf-dark-green-theme">墨绿</option>
              <option value="xf-wine-theme">酒红</option>
              <option value="random-theme">随机</option>
            </Select>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input
                label="播放器宽度"
                value={draft.music.playerWidth}
                onChange={(e) => setMusic({ playerWidth: e.target.value })}
              />
              <Input label="底部距离" value={draft.music.bottom} onChange={(e) => setMusic({ bottom: e.target.value })} />
              <Input
                label="歌单高度"
                value={draft.music.songListHeight}
                onChange={(e) => setMusic({ songListHeight: e.target.value })}
              />
              <Input
                label="歌单可视数量"
                type="number"
                min={1}
                max={20}
                value={draft.music.visibleSongListCount}
                onChange={(e) => setMusic({ visibleSongListCount: Number(e.target.value) || 4 })}
              />
            </div>
            <Input
              label="音量（0 - 1）"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.music.volume}
              onChange={(e) => setMusic({ volume: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
              wrapperClassName="sm:max-w-xs"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Switch
                checked={draft.music.isAutoPopup}
                onChange={(isAutoPopup) => setMusic({ isAutoPopup })}
                label="自动展开播放器"
                description="仅展开界面，不触发播放"
                className="rounded-lg border border-border p-3"
              />
              <Switch
                checked={draft.music.isAutoPlaylist}
                onChange={(isAutoPlaylist) => setMusic({ isAutoPlaylist })}
                label="默认展开歌单"
                className="rounded-lg border border-border p-3"
              />
              <Switch
                checked={draft.music.colorfulLyric}
                onChange={(colorfulLyric) => setMusic({ colorfulLyric })}
                label="彩色歌词"
                className="rounded-lg border border-border p-3"
              />
              <Switch
                checked={draft.music.audioVisualizer}
                onChange={(audioVisualizer) => setMusic({ audioVisualizer })}
                label="音频可视化"
                description="波形进度条（需音频允许跨域分析）"
                className="rounded-lg border border-border p-3"
              />
              <Switch
                checked={draft.music.rememberPlayback}
                onChange={(rememberPlayback) => setMusic({ rememberPlayback })}
                label="记忆播放"
                description="记住上次的歌曲与进度"
                className="rounded-lg border border-border p-3"
              />
            </div>
          </Section>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="自定义 CSS" description="直接注入到页面，可用于微调样式" icon="palette">
            <Textarea
              value={draft.advanced.customCss}
              onChange={(e) => update('advanced', { ...draft.advanced, customCss: e.target.value })}
              rows={10}
              className="font-mono text-sm"
              placeholder=".prose-article h2 { letter-spacing: -0.01em; }"
            />
          </Section>
          <Section title="注入 HTML" description="页头 / 页脚注入（统计脚本、验证标签等），请谨慎使用" icon="fileText">
            <Textarea
              label="页头 HTML"
              value={draft.advanced.headHtml}
              onChange={(e) => update('advanced', { ...draft.advanced, headHtml: e.target.value })}
              rows={5}
              className="font-mono text-sm"
            />
            <Textarea
              label="页脚 HTML"
              value={draft.advanced.footerHtml}
              onChange={(e) => update('advanced', { ...draft.advanced, footerHtml: e.target.value })}
              rows={5}
              className="font-mono text-sm"
            />
          </Section>
          <Section title="访问统计" description="选择统计服务并填入对应标识" icon="globe">
            <Select
              label="统计服务"
              value={draft.advanced.analytics.provider}
              onChange={(e) =>
                update('advanced', {
                  ...draft.advanced,
                  analytics: { ...draft.advanced.analytics, provider: e.target.value as 'none' | 'plausible' | 'umami' | 'ga4' },
                })
              }
            >
              <option value="none">不启用</option>
              <option value="plausible">Plausible（域名）</option>
              <option value="umami">Umami（脚本地址）</option>
              <option value="ga4">Google Analytics 4（衡量 ID）</option>
            </Select>
            {draft.advanced.analytics.provider !== 'none' && (
              <Input
                label="标识"
                value={draft.advanced.analytics.token}
                onChange={(e) =>
                  update('advanced', { ...draft.advanced, analytics: { ...draft.advanced.analytics, token: e.target.value } })
                }
              />
            )}
          </Section>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-faint">
        默认值参考：站点 {DEFAULT_SETTINGS.site.name} · 主题预设 {DEFAULT_SETTINGS.theme.preset}
      </p>
    </div>
  );
}
