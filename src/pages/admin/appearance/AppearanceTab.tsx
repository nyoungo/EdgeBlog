import type { CSSProperties } from 'react';
import type { ThemePreset, ThemeSettings } from '@shared/types';
import { Input, Select } from '../../../components/ui/Field';
import { MediaField } from '../../../components/admin/MediaField';
import { brandShades, hexToRgb, hexToRgbChannels, rgbToChannels } from '../../../lib/color';
import { cn } from '../../../lib/utils';
import { CODE_THEMES } from '../../../lib/code-themes';
import { BACKGROUND_LAYOUT, RADIUS } from '../../../lib/theme';
import { useAppearance } from './context';
import { ColorField, Row, Section, Segmented } from './ui';

const PRESETS: Array<{ value: ThemePreset; label: string; hint: string }> = [
  { value: 'ink', label: '墨白', hint: '靛蓝主色，中性偏冷' },
  { value: 'midnight', label: '深海', hint: '海蓝主色，冷灰底' },
  { value: 'solar', label: '暖阳', hint: '橙红主色，暖米底' },
  { value: 'seasaltt', label: '海盐', hint: '青绿主色，青灰底' },
  { value: 'forest', label: '森绿', hint: '草绿主色，绿灰底' },
  { value: 'cyber', label: '霓虹', hint: '品红主色，紫灰底' },
];

const BG_LAYOUT_OPTIONS: Array<{ value: ThemeSettings['backgroundLayout']; label: string }> = [
  { value: 'cover', label: '铺满裁剪' },
  { value: 'contain', label: '完整显示' },
  { value: 'center', label: '居中不重复' },
  { value: 'tile', label: '平铺' },
  { value: 'repeat-x', label: '横向平铺' },
  { value: 'repeat-y', label: '纵向平铺' },
];

const FONT_OPTIONS: Array<{ value: ThemeSettings['fontBody']; label: string }> = [
  { value: 'sans', label: '系统无衬线' },
  { value: 'serif', label: '系统衬线' },
  { value: 'mono', label: '系统等宽' },
];

/**
 * A real mini page rendered with the preset's own tokens: the wrapper carries
 * `data-theme` / `data-mode`, so every child resolves `--c-*` from that preset
 * instead of the currently active one. No colour values are duplicated in TS.
 */
function ThemeSwatch({ preset, mode }: { preset: ThemePreset; mode: 'light' | 'dark' }) {
  return (
    <span
      data-theme={preset}
      data-mode={mode}
      aria-hidden="true"
      className="flex h-16 flex-col justify-end gap-1 overflow-hidden rounded bg-bg p-1.5"
    >
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
        <span className="h-1 w-7 rounded-full bg-fg/70" />
      </span>
      <span className="h-1 w-9 rounded-full bg-faint/70" />
      <span className="mt-0.5 h-3 w-full rounded-sm border border-border bg-surface" />
    </span>
  );
}

/**
 * 亮/暗对照面板里的实际取值：`data-theme` 会把继承下来的自定义主色和背景色
 * 覆盖回预设，所以这里显式内联一份，面板才等于访客最终看到的效果。
 */
function panelVars(theme: ThemeSettings, dark: boolean): CSSProperties {
  const vars: Record<string, string> = {};

  const bgHex = dark ? theme.backgroundColorDark : theme.backgroundColorLight;
  const bg = bgHex ? hexToRgbChannels(bgHex) : null;
  if (bg) vars['--c-bg'] = bg;

  const rgb = theme.primaryColor ? hexToRgb(theme.primaryColor) : null;
  if (rgb) {
    const shades = brandShades(rgb, dark);
    vars['--c-brand'] = rgbToChannels(rgb);
    vars['--c-brand-fg'] = shades.fg;
    vars['--c-brand-hover'] = shades.hover;
    vars['--c-brand-active'] = shades.active;
  }

  return vars as CSSProperties;
}

export function AppearanceTab() {
  const { draft, setTheme, pickMedia } = useAppearance();
  const { theme } = draft;
  const bgPreview = BACKGROUND_LAYOUT[theme.backgroundLayout] ?? BACKGROUND_LAYOUT.cover;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title="配色方案"
        description="每套预设自带亮色/暗色两套中性色，下方预览即真实取色"
        icon="palette"
        className="xl:col-span-2"
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {PRESETS.map((p) => {
            const active = theme.preset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={active}
                onClick={() => setTheme({ preset: p.value })}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors',
                  active
                    ? 'border-brand bg-brand/5 ring-1 ring-brand/30'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                <span className="grid grid-cols-2 gap-1 rounded bg-surface-2 p-1">
                  <ThemeSwatch preset={p.value} mode="light" />
                  <ThemeSwatch preset={p.value} mode="dark" />
                </span>
                <span className="flex min-w-0 items-center gap-1.5 px-0.5">
                  <span
                    data-theme={p.value}
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                  />
                  <span className="truncate text-xs font-medium text-fg">{p.label}</span>
                </span>
                <span className="px-0.5 text-[11px] leading-snug text-faint">{p.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Row label="默认模式" description="访客首次进入时使用；可随时在顶栏切换">
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
          <ColorField
            label="自定义主色"
            value={theme.primaryColor}
            onChange={(primaryColor) => setTheme({ primaryColor })}
            placeholder="留空使用预设主色"
            hint="按钮、链接、选中态都跟随它；文字色与悬停/按下色会自动计算。"
          />
        </div>

        {/* 派生色随主色实时变化，用来确认浅色主色上的文字仍然可读。 */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/40 p-2.5">
          <span className="flex h-8 items-center rounded-md bg-brand px-3 text-xs font-medium text-brand-fg">
            主色
          </span>
          <span className="flex h-8 items-center rounded-md bg-brand-hover px-3 text-xs font-medium text-brand-fg">
            悬停
          </span>
          <span className="flex h-8 items-center rounded-md bg-brand-active px-3 text-xs font-medium text-brand-fg">
            按下
          </span>
          <span className="ml-auto text-[11px] text-muted">文字色自动取黑白中对比度更高的一个</span>
        </div>
      </Section>

      <Section title="全局背景" description="亮色与暗色可分别设置，背景图两模式共用" icon="image">
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField
            label="亮色背景"
            value={theme.backgroundColorLight}
            onChange={(backgroundColorLight) => setTheme({ backgroundColorLight })}
            placeholder="留空使用预设底色"
          />
          <ColorField
            label="暗色背景"
            value={theme.backgroundColorDark}
            onChange={(backgroundColorDark) => setTheme({ backgroundColorDark })}
            placeholder="留空使用预设底色"
          />
        </div>
        <MediaField
          label="背景图"
          value={theme.backgroundImage}
          placeholder="https://… 或 /media/…"
          preview={false}
          hint="支持外链或 /media/… 相对地址；下方遮罩用当前背景色压暗。"
          onChange={(backgroundImage) => setTheme({ backgroundImage })}
          onPick={() => pickMedia('image', (item) => setTheme({ backgroundImage: item.url }))}
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
            <p className="min-w-0 break-all text-xs text-muted">
              <span className="block font-medium text-fg">背景预览</span>
              {theme.backgroundImage}
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-fg">布局方式</span>
          <Segmented
            value={theme.backgroundLayout}
            onChange={(backgroundLayout) => setTheme({ backgroundLayout })}
            options={BG_LAYOUT_OPTIONS}
          />
          <p className="text-xs text-muted">
            「铺满裁剪」自动缩放填满屏幕；「平铺」适合纹理花纹图，按原始尺寸重复。
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
          label="遮罩浓度"
          type="number"
          min={0}
          max={0.9}
          step={0.05}
          value={theme.backgroundScrim}
          onChange={(e) =>
            setTheme({ backgroundScrim: Math.min(0.9, Math.max(0, Number(e.target.value) || 0)) })
          }
          hint="0–0.9，用背景色压暗图片，保证文字可读。"
          wrapperClassName="sm:max-w-[10rem]"
        />
      </Section>

      <Section title="字体" description="全部使用系统自带字体，不依赖网络加载" icon="fileText">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="正文字体"
            value={theme.fontBody}
            onChange={(e) => setTheme({ fontBody: e.target.value as ThemeSettings['fontBody'] })}
          >
            {FONT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            label="标题字体"
            value={theme.fontHeading}
            onChange={(e) =>
              setTheme({ fontHeading: e.target.value as ThemeSettings['fontHeading'] })
            }
          >
            {FONT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="font-heading text-base font-semibold text-fg">标题字体示例 Aa 文章标题</p>
          <p className="text-sm text-muted" style={{ fontFamily: 'var(--font-body)' }}>
            正文字体示例：好的排版让长文读起来不费力，中文与 English 混排也应保持节奏。
          </p>
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
      </Section>

      <Section title="版式与代码" description="圆角、内容宽度与代码块配色" icon="columns">
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
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
          {(
            [
              { key: 'none', label: '直角' },
              { key: 'sm', label: '小' },
              { key: 'md', label: '中' },
              { key: 'lg', label: '大' },
            ] as const
          ).map((item) => (
            <div key={item.key} className="flex flex-col items-center gap-1">
              <span
                aria-hidden="true"
                className="h-8 w-12 border border-border bg-surface"
                style={{ borderRadius: RADIUS[item.key] }}
              />
              <span className="text-[11px] text-faint">{item.label}</span>
            </div>
          ))}
        </div>
        <Input
          label="内容最大宽度"
          value={theme.maxWidth}
          onChange={(e) => setTheme({ maxWidth: e.target.value })}
          placeholder="72ch"
          hint="支持 ch / px / rem，如 72ch 或 760px。"
          wrapperClassName="sm:max-w-[12rem]"
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
        {/* 代码块使用真实 highlight.js 类名，注入的高亮主题会直接作用在这里。 */}
        <div className="overflow-hidden rounded-lg border border-border">
          <pre className="m-0 overflow-x-auto text-xs leading-relaxed">
            <code className="hljs">
              <span className="hljs-keyword">const</span>{' '}
              <span className="hljs-title function_">greet</span> = (
              <span className="hljs-params">name</span>) =&gt;{' '}
              <span className="hljs-string">`hello ${'{'}name{'}'}`</span>;
            </code>
          </pre>
        </div>
      </Section>

      <Section
        title="效果预览"
        description="改动会实时同步到整个后台与前台"
        icon="sparkles"
        className="xl:col-span-2"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-border bg-bg p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-9 items-center rounded-md bg-brand px-3 text-sm font-medium text-brand-fg">
                主要按钮
              </span>
              <span className="flex h-9 items-center rounded-md border border-border bg-surface-2 px-3 text-sm text-fg">
                次要按钮
              </span>
              <a href="#preview" className="text-sm font-medium text-brand underline-offset-4 hover:underline">
                链接文字
              </a>
            </div>
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="text-sm font-semibold text-fg">卡片标题</p>
              <p className="mt-1 text-xs text-muted">正文说明文字，用来看正文色与背景的层次。</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                  品牌标签
                </span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                  中性标签
                </span>
              </div>
            </div>
            <input
              readOnly
              placeholder="输入框占位文字"
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg placeholder:text-faint"
            />
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-success" /> 成功
              <span className="h-2 w-2 rounded-full bg-warning" /> 警告
              <span className="h-2 w-2 rounded-full bg-danger" /> 错误
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-4">
            <p className="text-sm font-semibold text-fg">明暗对照</p>
            <p className="text-xs text-muted">
              左为亮色、右为暗色，都使用当前预设与自定义背景色。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div
                data-theme={theme.preset}
                data-mode="light"
                style={panelVars(theme, false)}
                className="space-y-1.5 rounded-md border border-border bg-bg p-2.5"
              >
                <div className="h-1.5 w-8 rounded-full bg-brand" />
                <div className="h-1 w-12 rounded-full bg-fg/60" />
                <div className="h-1 w-10 rounded-full bg-faint/60" />
                <div className="mt-1 h-6 rounded border border-border bg-surface" />
              </div>
              <div
                data-theme={theme.preset}
                data-mode="dark"
                style={panelVars(theme, true)}
                className="space-y-1.5 rounded-md border border-border bg-bg p-2.5"
              >
                <div className="h-1.5 w-8 rounded-full bg-brand" />
                <div className="h-1 w-12 rounded-full bg-fg/60" />
                <div className="h-1 w-10 rounded-full bg-faint/60" />
                <div className="mt-1 h-6 rounded border border-border bg-surface" />
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}