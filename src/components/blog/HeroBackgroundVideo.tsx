import { useEffect, useRef, useState } from 'react';
import { normalizeVideoRange } from '../../lib/hero-video';
import { cn } from '../../lib/utils';

interface HeroBackgroundVideoProps {
  src: string;
  poster?: string;
  loop: boolean;
  /** Loop range start in seconds. The first pass always starts at 0. */
  start: number;
  /** Loop range end in seconds; 0 means the end of the clip. */
  end: number;
}

/** Cross-fade duration between the two video layers. */
const SWAP_FADE_MS = 500;
/** Start pre-seeking the standby layer slightly before the loop boundary. */
const PREPARE_LEAD_SECONDS = 0.35;
/** Treat positions within this distance of the end as "reached the end". */
const BOUNDARY_EPSILON = 0.02;

/**
 * Hero background video with an optional custom loop range.
 *
 * The native `loop` attribute always jumps back to 0, and seeking one element
 * on every loop causes a visible stall. Instead two stacked <video> elements
 * alternate: while the active clip nears `end`, the hidden one is seeked to
 * `start`; at the boundary they cross-fade and the old layer is rewound behind
 * the scenes. The first pass always starts at 0.
 *
 * With `loop` off the video pauses on the last frame (or exactly at `end`).
 */
export function HeroBackgroundVideo({ src, poster, loop, start, end }: HeroBackgroundVideoProps) {
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  // Read the latest settings from inside the animation loop without tearing
  // down and recreating the video elements when the admin tweaks a number.
  const config = useRef({ loop, start, end });
  config.current = { loop, start, end };

  useEffect(() => {
    const first = firstRef.current;
    const second = secondRef.current;
    if (!first || !second || !src) return;

    const layer = (index: number) => (index === 0 ? first : second);
    const currentVideo = () => layer(activeRef.current);

    // A new source always starts on the first layer / the first pass.
    activeRef.current = 0;
    setActive(0);

    let frame = 0;
    let resetTimer = 0;
    let prepared = -1;
    let started = false;
    let disposed = false;

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const range = () => {
      const video = currentVideo();
      return normalizeVideoRange(video.duration, config.current.start, config.current.end);
    };

    const schedule = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(tick);
    };

    /**
     * Seek the hidden layer to the loop start while it is invisible, so the
     * expensive part of the jump happens before the cross-fade.
     */
    const prepare = () => {
      const nextIndex = 1 - activeRef.current;
      const next = layer(nextIndex);
      const { start: startAt } = range();

      if (resetTimer) {
        window.clearTimeout(resetTimer);
        resetTimer = 0;
      }
      prepared = nextIndex;
      next.pause();
      try {
        next.currentTime = startAt;
      } catch {
        prepared = -1;
      }
    };

    const swap = () => {
      const prevIndex = activeRef.current;
      const nextIndex = 1 - prevIndex;
      const prev = layer(prevIndex);
      const next = layer(nextIndex);
      const { start: startAt } = range();

      // Extremely short loop windows may reach the boundary before `prepare`
      // ran; make sure the incoming layer at least starts at the loop head.
      if (prepared !== nextIndex) {
        try {
          next.currentTime = startAt;
        } catch {
          /* not ready */
        }
      }

      prev.pause();
      activeRef.current = nextIndex;
      setActive(nextIndex);
      prepared = -1;
      void next.play().catch(() => undefined);

      // Rewind the hidden outgoing layer after its fade-out finishes.
      if (resetTimer) window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        resetTimer = 0;
        if (disposed) return;
        try {
          prev.currentTime = startAt;
        } catch {
          /* not ready */
        }
      }, SWAP_FADE_MS);

      schedule();
    };

    const tick = () => {
      frame = 0;
      if (disposed) return;

      const video = currentVideo();
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const { start: startAt, end: endAt } = normalizeVideoRange(
        duration,
        config.current.start,
        config.current.end,
      );

      if (endAt <= 0) {
        if (!video.paused && !video.ended) schedule();
        return;
      }

      const segment = Math.max(0.1, endAt - startAt);
      const lead = Math.min(PREPARE_LEAD_SECONDS, segment * 0.35);
      if (config.current.loop && prepared < 0 && video.currentTime >= endAt - lead) {
        prepare();
      }

      if (video.currentTime >= endAt - BOUNDARY_EPSILON) {
        if (config.current.loop) {
          if (prepared < 0) prepare();
          swap();
        } else {
          video.pause();
          if (endAt < duration - BOUNDARY_EPSILON) video.currentTime = endAt;
          stop();
        }
        return;
      }

      if (!video.paused && !video.ended) schedule();
    };

    const begin = () => {
      if (disposed || started) return;
      started = true;

      const { start: startAt } = range();
      first.pause();
      second.pause();
      activeRef.current = 0;
      setActive(0);
      try {
        first.currentTime = 0;
      } catch {
        /* not ready */
      }
      try {
        second.currentTime = startAt;
      } catch {
        /* not ready */
      }
      void first.play().catch(() => undefined);
      schedule();
    };

    const onPlay = (event: Event) => {
      if (event.currentTarget === currentVideo()) schedule();
    };

    const onEnded = (event: Event) => {
      if (event.currentTarget !== currentVideo()) return;
      if (!config.current.loop) {
        stop();
        return;
      }
      if (prepared < 0) prepare();
      swap();
    };

    first.addEventListener('play', onPlay);
    second.addEventListener('play', onPlay);
    first.addEventListener('ended', onEnded);
    second.addEventListener('ended', onEnded);
    if (first.readyState >= 1) begin();
    else first.addEventListener('loadedmetadata', begin, { once: true });

    return () => {
      disposed = true;
      stop();
      if (resetTimer) window.clearTimeout(resetTimer);
      first.removeEventListener('loadedmetadata', begin);
      first.removeEventListener('play', onPlay);
      second.removeEventListener('play', onPlay);
      first.removeEventListener('ended', onEnded);
      second.removeEventListener('ended', onEnded);
      first.pause();
      second.pause();
    };
  }, [src]);

  const videoClass = (index: number) =>
    cn(
      'eb-hero-video pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-linear',
      active === index ? 'opacity-100' : 'opacity-0',
    );

  return (
    <>
      <video
        key={`hero-a-${src}`}
        ref={firstRef}
        className={videoClass(0)}
        src={src}
        poster={poster || undefined}
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
      />
      <video
        key={`hero-b-${src}`}
        ref={secondRef}
        className={videoClass(1)}
        src={src}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
