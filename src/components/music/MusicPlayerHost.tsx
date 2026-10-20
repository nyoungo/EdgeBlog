import { useEffect, useMemo, useRef } from 'react';
import type { MusicPlayer } from 'xf-music-player';
import type { ThemeSettings } from '@shared/types';
import { useSettings } from '../../providers/SettingsProvider';
import { hexToRgbChannels } from '../../lib/theme';

const TAG_NAME = 'xf-blog-player';
const MEMORY_KEY = 'eb-music-player';

const DEFAULT_BRAND = '99 102 241';

/** Accent channel triples per preset (mirrors src/styles/tokens.css). */
const PRESET_BRAND: Record<string, string> = {
  ink: DEFAULT_BRAND,
  midnight: '59 130 246',
  solar: '234 88 12',
  seasaltt: '13 148 136',
  forest: '22 163 74',
  cyber: '217 70 239',
};

/**
 * Theme class names the player may put on its wrapper. The accent override
 * targets all of them (plus the dynamic `auto-theme` / `random-theme`) so it
 * wins no matter which theme the player resolved.
 */
const THEME_CLASSES = [
  'xf-theme',
  'xf-original-theme',
  'xf-orange-theme',
  'xf-pink-theme',
  'xf-dark-green-theme',
  'xf-wine-theme',
  'xf-sky-theme',
  'xf-dark-theme',
  'auto-theme',
  'random-theme',
];

/** Resolve the site accent to a space-separated `r g b` channel triple. */
function brandChannels(theme: ThemeSettings): string {
  const custom = theme.primaryColor ? hexToRgbChannels(theme.primaryColor) : null;
  return custom ?? PRESET_BRAND[theme.preset] ?? DEFAULT_BRAND;
}

/** Blend a channel triple towards white by `ratio` (0-1) for the lyric tints. */
function tint(channels: string, ratio: number): string {
  const [r = 0, g = 0, b = 0] = channels.split(/\s+/).map(Number);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  return `${mix(r)} ${mix(g)} ${mix(b)}`;
}

/**
 * Player CSS that overrides the theme accent with the blog's brand colour.
 * Injected into the player's shadow root via `customThemeStyle`; the doubled
 * class specificity (`.default-cursor.<theme>`) beats the built-in theme rules.
 */
function accentStyle(channels: string): string {
  const selectors = THEME_CLASSES.map((name) => `.default-cursor.${name}`).join(',');
  const declarations = [
    `--theme-color:rgb(${channels})`,
    `--text-hover-color:rgb(${channels})`,
    `--text-hover-color-rgb:${channels.split(/\s+/).join(', ')}`,
    `--song-name-color:rgb(${channels})`,
    `--notes-color-1:rgb(${channels})`,
    `--notes-color-2:rgb(${tint(channels, 0.45)})`,
    `--notes-color-3:rgb(${tint(channels, 0.75)})`,
  ].join(';');
  return `${selectors}{${declarations}}`;
}

/** Events that count as a user gesture for the autoplay rescue. */
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * Browsers block audio that starts without a user gesture, so an autoplay
 * attempt on load normally fails. Retry once on the first gesture: by then the
 * play request is allowed and clears the player's "无法开始播放" error state.
 */
function armAutoplayRescue(player: MusicPlayer): () => void {
  const onGesture = () => {
    cleanup();
    try {
      if (!player.configState.getState().playback.isPlaying) player.play();
    } catch (err) {
      console.error('[music] autoplay rescue failed', err);
    }
  };
  const cleanup = () => {
    for (const type of GESTURE_EVENTS) document.removeEventListener(type, onGesture, true);
  };
  for (const type of GESTURE_EVENTS) document.addEventListener(type, onGesture, true);
  return cleanup;
}

/**
 * Single owner of the XF Music Player instance for the public site.
 *
 * * Disabled by default — the (large) player bundle is only fetched when
 *   `settings.music.enabled` is true, so visitors never pay for it otherwise.
 * * Exactly one active player: create/destroy are serialized through a promise
 *   chain so a config change can never race the previous instance.
 * * The player's accent colour always follows the blog theme, and `auto-theme`
 *   follows the blog's light/dark mode instead of the OS preference.
 */
export function MusicPlayerHost() {
  const { settings, resolvedDark } = useSettings();
  const { music } = settings;
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<MusicPlayer | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const rescueRef = useRef<(() => void) | null>(null);

  const channels = useMemo(() => brandChannels(settings.theme), [settings.theme]);

  const effectiveTheme =
    music.theme === 'auto-theme' ? (resolvedDark ? 'xf-dark-theme' : 'xf-original-theme') : music.theme;

  // Only re-run when the music config, the resolved theme or the accent change.
  const signature = JSON.stringify({ music, effectiveTheme, channels });

  useEffect(() => {
    chainRef.current = chainRef.current
      .then(async () => {
        rescueRef.current?.();
        rescueRef.current = null;
        if (playerRef.current) {
          const stale = playerRef.current;
          playerRef.current = null;
          await stale.destroy();
        }
        const host = hostRef.current;
        if (!music.enabled || !host) return;

        const { MusicPlayer } = await import('xf-music-player');
        if (!hostRef.current) return;

        playerRef.current = new MusicPlayer({
          tagName: TAG_NAME,
          language: music.language,
          isMonitoring: false,
          mountElement: host,
          attributes: {
            theme: effectiveTheme,
            customThemeStyle: accentStyle(channels),
            mode: music.mode,
            apiUrl: music.mode === 'cloud' ? music.apiUrl : undefined,
            playerWidth: music.playerWidth,
            bottom: music.bottom,
            songListHeight: music.songListHeight,
            visibleSongListCount: music.visibleSongListCount,
            volume: music.volume,
            playMode: music.playMode,
            isAutoPopup: music.isAutoPopup,
            isAutoPlaylist: music.isAutoPlaylist,
            autoplay: music.autoplay,
            colorfulLyric: music.colorfulLyric,
            audioVisualizer: music.audioVisualizer,
            rememberPlayback: music.rememberPlayback,
            memoryKey: MEMORY_KEY,
            environment: 'production',
            playlist:
              music.mode === 'local'
                ? music.playlist.map((track) => ({
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    cover: track.cover,
                    src: track.src,
                  }))
                : undefined,
          },
        });
        if (music.autoplay) rescueRef.current = armAutoplayRescue(playerRef.current);
      })
      .catch((err) => {
        console.error('[music] player init failed', err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(
    () => () => {
      rescueRef.current?.();
      rescueRef.current = null;
      chainRef.current = chainRef.current
        .then(async () => {
          if (playerRef.current) {
            const player = playerRef.current;
            playerRef.current = null;
            await player.destroy();
          }
        })
        .catch(() => {});
    },
    [],
  );

  return <div ref={hostRef} />;
}
