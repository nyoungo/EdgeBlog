import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PublicSettings, ThemeMode } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { api } from '../lib/api';
import {
  applyAdvanced,
  applyTheme,
  persistMode,
  persistTheme,
  readStoredMode,
  resolveDark,
} from '../lib/theme';

interface SettingsApi {
  /** Merged server config, falling back to the shared defaults before load. */
  settings: PublicSettings;
  /** Effective mode: local override (from the toggle) wins over the config. */
  mode: ThemeMode;
  resolvedDark: boolean;
  loading: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  /** Replace the in-memory config (e.g. after the Appearance panel saves). */
  setSettings: (next: PublicSettings) => void;
  reload: () => Promise<void>;
}

const SettingsContext = createContext<SettingsApi | null>(null);

/**
 * Settings the shell inlined for us (see `injectBootSettings` on the server).
 * Reading them synchronously means the first paint already shows the real site
 * name/logo/theme instead of flashing the defaults.
 */
function readBootSettings(): PublicSettings | null {
  if (typeof document === 'undefined') return null;
  const raw = document.getElementById('eb-boot-settings')?.textContent;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PublicSettings;
    if (typeof parsed?.site?.name !== 'string' || typeof parsed?.theme?.preset !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

let bootSettingsCache: PublicSettings | null | undefined;

function bootSettings(): PublicSettings | null {
  if (bootSettingsCache === undefined) bootSettingsCache = readBootSettings();
  return bootSettingsCache;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<PublicSettings>(() => bootSettings() ?? DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(() => bootSettings() === null);
  const [modeOverride, setModeOverride] = useState<ThemeMode | null>(() => readStoredMode());

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get<PublicSettings>('/settings/public');
      setSettingsState(data);
    } catch {
      /* keep defaults; the site still renders */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Already hydrated from the shell payload — no fetch, no flicker.
    if (bootSettings()) {
      setLoading(false);
      return;
    }
    void reload();
  }, [reload]);

  const mode: ThemeMode = modeOverride ?? settings.theme.mode;

  // Apply the derived theme whenever config or mode changes.
  useEffect(() => {
    applyTheme({ ...settings.theme, mode });
    applyAdvanced(settings.advanced);
  }, [settings.theme, settings.advanced, mode]);

  // Follow the OS preference live while in "system" mode.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme({ ...settings.theme, mode: 'system' });
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode, settings.theme]);

  // Remember the preset so the pre-paint script restores the right palette.
  useEffect(() => {
    persistTheme(settings.theme.preset);
  }, [settings.theme.preset]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeOverride(next);
    persistMode(next);
  }, []);

  const toggleMode = useCallback(() => {
    const dark = resolveDark(mode);
    setMode(dark ? 'light' : 'dark');
  }, [mode, setMode]);

  const setSettings = useCallback((next: PublicSettings) => setSettingsState(next), []);

  const value = useMemo<SettingsApi>(
    () => ({
      settings,
      mode,
      resolvedDark: resolveDark(mode),
      loading,
      setMode,
      toggleMode,
      setSettings,
      reload,
    }),
    [settings, mode, loading, setMode, toggleMode, setSettings, reload],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within <SettingsProvider>');
  return ctx;
}

/** Convenience hook for components that only need the config object. */
export function useSiteSettings(): PublicSettings {
  return useSettings().settings;
}
