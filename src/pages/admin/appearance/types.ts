import type {
  CommentSettings,
  FeatureFlags,
  HeaderSettings,
  HeroSettings,
  LayoutSettings,
  MediaItem,
  MusicSettings,
  PublicSettings,
  SiteSettings,
  ThemeSettings,
} from '@shared/types';
import type { IconName } from '../../../components/ui/icons';

/** Settings namespaces writable from this page. */
export type Namespace =
  | 'site'
  | 'theme'
  | 'layout'
  | 'navigation'
  | 'social'
  | 'features'
  | 'comments'
  | 'pages'
  | 'advanced'
  | 'music';

/**
 * Tabs follow the area of the site they affect, not the storage namespace:
 * one tab can write several namespaces, and one namespace can be edited from
 * several tabs (e.g. feature flags live next to the region they belong to).
 */
export type TabId =
  | 'identity'
  | 'navfooter'
  | 'home'
  | 'content'
  | 'comments'
  | 'appearance'
  | 'music'
  | 'advanced';

/** A single value restored by "恢复本页默认"; empty path = whole namespace. */
export interface FieldPath {
  ns: Namespace;
  path: string[];
}

export interface TabDef {
  id: TabId;
  label: string;
  icon: IconName;
  hint: string;
  /** Namespaces this tab touches (drives the save payload and dirty marks). */
  namespaces: Namespace[];
  defaults: FieldPath[];
}

export type MediaKind = 'image' | 'video';

/** Everything a tab needs from the page shell. */
export interface DraftApi {
  draft: PublicSettings;
  update<K extends Namespace>(ns: K, value: PublicSettings[K]): void;
  setSite(patch: Partial<SiteSettings>): void;
  setTheme(patch: Partial<ThemeSettings>): void;
  setLayout(patch: Partial<LayoutSettings>): void;
  setHeader(patch: Partial<HeaderSettings>): void;
  setHero(patch: Partial<HeroSettings>): void;
  setFeatures(patch: Partial<FeatureFlags>): void;
  setComments(patch: Partial<CommentSettings>): void;
  setMusic(patch: Partial<MusicSettings>): void;
  setAdvanced(patch: Partial<PublicSettings['advanced']>): void;
  /** Open the shared media-library dialog for one field. */
  pickMedia(kind: MediaKind, onSelect: (item: MediaItem) => void): void;
}