import { useEffect, useRef, useState } from 'react';
import type { MediaItem, PublicSettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { Button, buttonStyles } from '../../components/ui/Button';
import { Icon } from '../../components/ui/icons';
import { MediaPicker } from '../../components/admin/MediaPicker';
import { cn } from '../../lib/utils';
import { normalizeHeroMedia } from '../../lib/hero-media';
import { normalizeThemeBackground } from '../../lib/theme';
import { api } from '../../lib/api';
import { useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { AppearanceContext } from './appearance/context';
import { GROUPS, TAB_COMPONENTS, TAB_DEFS, TAB_MAP } from './appearance/registry';
import type { FieldPath, MediaKind, Namespace, TabId } from './appearance/types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merge a partial patch into an object (arrays and scalars replace). */
function applyPatch<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? applyPatch(out[key], value) : value;
  }
  return out as T;
}

/** Build "only these fields" patches from the canonical defaults. */
function defaultsPatch(entries: FieldPath[]): Array<[Namespace, unknown]> {
  const byNamespace = new Map<Namespace, unknown>();
  for (const { ns, path } of entries) {
    let value: unknown = DEFAULT_SETTINGS[ns];
    for (const key of path) {
      value = isPlainObject(value) ? value[key] : undefined;
      if (value === undefined) break;
    }
    if (value === undefined) continue;

    if (path.length === 0) {
      byNamespace.set(ns, structuredClone(value));
      continue;
    }

    // Rebuild the nested shape: ['hero','textColor'] -> { hero: { textColor } }
    let branch: unknown = structuredClone(value);
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const key = path[i];
      if (key === undefined) continue;
      branch = { [key]: branch };
    }
    const current = byNamespace.get(ns);
    byNamespace.set(ns, isPlainObject(current) ? applyPatch(current, branch) : branch);
  }
  return [...byNamespace.entries()];
}

/** Split legacy single-field values (hero media, theme background) into the fields the editor writes. */
function normalizeDraft(settings: PublicSettings): PublicSettings {
  const hero = settings.layout.hero;
  const { backgroundMedia, backgroundImage, backgroundVideo } = normalizeHeroMedia(hero);
  const heroChanged = !(
    backgroundMedia === hero.backgroundMedia &&
    backgroundImage === hero.backgroundImage &&
    backgroundVideo === hero.backgroundVideo
  );

  const theme = settings.theme;
  const background = normalizeThemeBackground(theme);
  const themeChanged = !(
    background.backgroundColor === theme.backgroundColor &&
    background.backgroundColorLight === theme.backgroundColorLight &&
    background.backgroundColorDark === theme.backgroundColorDark
  );

  if (!heroChanged && !themeChanged) return settings;

  return {
    ...settings,
    layout: heroChanged
      ? { ...settings.layout, hero: { ...hero, backgroundMedia, backgroundImage, backgroundVideo } }
      : settings.layout,
    theme: themeChanged ? { ...theme, ...background } : theme,
  };
}

/** Dot shown on tabs with unsaved changes. */
function DirtyDot({ className }: { className?: string }) {
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', className ?? 'bg-warning')} aria-hidden="true" />;
}

export function AppearancePage() {
  const { settings, loading, setSettings, reload } = useSettings();
  const { success, error: toastError } = useToast();

  const [draft, setDraft] = useState<PublicSettings>(settings);
  const [tab, setTab] = useState<TabId>('identity');
  /** Namespaces with unsaved changes (the save payload). */
  const [dirty, setDirty] = useState<Set<Namespace>>(new Set());
  /** Tabs with unsaved changes (drives the nav marks). */
  const [dirtyTabs, setDirtyTabs] = useState<Set<TabId>>(new Set());
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ready, setReady] = useState(false);

  /** Shared media-library dialog; the ref holds the field being edited. */
  const mediaHandler = useRef<(item: MediaItem) => void>(() => {});
  const [pickerKind, setPickerKind] = useState<MediaKind | null>(null);

  useDocumentTitle('站点设置', settings.site.name);

  // Seed the draft once the server config has loaded.
  useEffect(() => {
    if (!loading && !ready) {
      setDraft(normalizeDraft(settings));
      setReady(true);
    }
  }, [loading, ready, settings]);

  const update = <K extends Namespace>(ns: K, value: PublicSettings[K]) => {
    const next = { ...draft, [ns]: value } as PublicSettings;
    setDraft(next);
    setSettings(next); // live preview
    setDirty((prev) => new Set(prev).add(ns));
    setDirtyTabs((prev) => new Set(prev).add(tab));
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
      setDirtyTabs(new Set());
      await reload();
      setReady(false);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** Restore only the fields this tab owns, leaving other tabs' edits intact. */
  const resetTab = async () => {
    setResetting(true);
    try {
      const patches = defaultsPatch(TAB_MAP[tab].defaults);
      for (const [ns, patch] of patches) {
        await api.patch(`/settings/${ns}`, patch);
      }

      // Mirror the change locally and keep unsaved edits from other tabs.
      const nextDraft = { ...draft };
      for (const [ns, patch] of patches) {
        Object.assign(nextDraft, { [ns]: applyPatch(draft[ns], patch) });
      }
      setDraft(nextDraft);
      setSettings(nextDraft);

      const remainingTabs = new Set([...dirtyTabs].filter((id) => id !== tab));
      setDirtyTabs(remainingTabs);
      setDirty(new Set([...remainingTabs].flatMap((id) => TAB_MAP[id].namespaces)));
      success('已恢复本页默认设置');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '恢复失败');
    } finally {
      setResetting(false);
    }
  };

  const pickMedia = (kind: MediaKind, onSelect: (item: MediaItem) => void) => {
    mediaHandler.current = onSelect;
    setPickerKind(kind);
  };

  const setSite = (patch: Partial<PublicSettings['site']>) => update('site', { ...draft.site, ...patch });
  const setTheme = (patch: Partial<PublicSettings['theme']>) => update('theme', { ...draft.theme, ...patch });
  const setLayout = (patch: Partial<PublicSettings['layout']>) => update('layout', { ...draft.layout, ...patch });
  const setHeader = (patch: Partial<PublicSettings['layout']['header']>) =>
    setLayout({ header: { ...draft.layout.header, ...patch } });
  const setHero = (patch: Partial<PublicSettings['layout']['hero']>) =>
    setLayout({ hero: { ...draft.layout.hero, ...patch } });
  const setFeatures = (patch: Partial<PublicSettings['features']>) =>
    update('features', { ...draft.features, ...patch });
  const setComments = (patch: Partial<PublicSettings['comments']>) =>
    update('comments', { ...draft.comments, ...patch });
  const setMusic = (patch: Partial<PublicSettings['music']>) => update('music', { ...draft.music, ...patch });
  const setAdvanced = (patch: Partial<PublicSettings['advanced']>) =>
    update('advanced', { ...draft.advanced, ...patch });

  if (!ready) {
    return <div className="py-20 text-center text-sm text-faint">载入中…</div>;
  }

  const currentTab = TAB_MAP[tab];
  const TabView = TAB_COMPONENTS[tab];

  const tabButton = (id: TabId, full: boolean) => {
    const def = TAB_MAP[id];
    const active = tab === id;
    const marked = dirtyTabs.has(id);
    if (full) {
      return (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
            active ? 'bg-brand/10 font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          <Icon name={def.icon} size={16} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{def.label}</span>
          {marked && <DirtyDot />}
        </button>
      );
    }
    return (
      <button
        key={id}
        type="button"
        onClick={() => setTab(id)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
          active
            ? 'border-brand bg-brand text-brand-fg'
            : 'border-border bg-surface text-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        <Icon name={def.icon} size={15} />
        {def.label}
        {marked && <DirtyDot className={active ? 'bg-brand-fg' : 'bg-warning'} />}
      </button>
    );
  };

  return (
    <AppearanceContext.Provider
      value={{
        draft,
        update,
        setSite,
        setTheme,
        setLayout,
        setHeader,
        setHero,
        setFeatures,
        setComments,
        setMusic,
        setAdvanced,
        pickMedia,
      }}
    >
      <div className="pb-2">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-fg">站点设置</h1>
            <p className="mt-1 text-sm text-muted">按站点、内容、外观与系统分组，修改实时预览、保存后永久生效</p>
          </div>
          <div className="flex items-center gap-2">
            {dirty.size > 0 && (
              <span className="hidden items-center gap-1.5 text-xs text-warning sm:inline-flex">
                <DirtyDot />
                有未保存的修改
              </span>
            )}
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'no-underline' })}
            >
              <Icon name="externalLink" size={15} />
              查看前台
            </a>
          </div>
        </header>

        {/* 窄屏：横向滚动的页签 */}
        <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-2 lg:hidden">
          {TAB_DEFS.map((def) => tabButton(def.id, false))}
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {/* 宽屏：左侧区域导航 */}
          <aside className="hidden w-56 shrink-0 lg:sticky lg:top-20 lg:block">
            <nav aria-label="设置分组" className="space-y-5 rounded-xl border border-border bg-surface p-3">
              {GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">{group.tabs.map((id) => tabButton(id, true))}</div>
                </div>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-fg">{currentTab.label}</h2>
              <p className="mt-0.5 text-xs text-muted">{currentTab.hint}</p>
            </div>

            <TabView />

            {/* 长表单滚到底也能直接保存 */}
            <div className="sticky bottom-0 z-20 mt-5 border-t border-border eb-glass py-3">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={cn(
                    'mr-auto flex items-center gap-1.5 text-xs',
                    dirty.size > 0 ? 'text-warning' : 'text-faint',
                  )}
                >
                  {dirty.size > 0 && <DirtyDot />}
                  {dirty.size > 0 ? '有未保存的修改' : '所有修改已保存'}
                </span>
                <Button variant="ghost" onClick={() => void resetTab()} loading={resetting}>
                  <Icon name="refresh" size={16} /> 恢复本页默认
                </Button>
                <Button onClick={() => void save()} loading={saving} disabled={dirty.size === 0}>
                  <Icon name="save" size={16} /> 保存修改
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MediaPicker
        open={pickerKind !== null}
        kind={pickerKind ?? 'image'}
        onClose={() => setPickerKind(null)}
        onSelect={(item) => mediaHandler.current(item)}
      />
    </AppearanceContext.Provider>
  );
}