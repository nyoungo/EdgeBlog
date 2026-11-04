import { useEffect, useRef } from 'react';
import { normalizeVideoRange } from '../../lib/hero-video';

interface HeroBackgroundVideoProps {
  src: string;
  poster?: string;
  loop: boolean;
  /** Loop range start in seconds. The first pass always starts at 0. */
  start: number;
  /** Loop range end in seconds; 0 means the end of the clip. */
  end: number;
}

/** Jump just before the clip actually ends, so no end-of-file frame is shown. */
const LOOP_GUARD_SECONDS = 0.001;

/**
 * Hero background video with an optional custom loop range.
 *
 * The native `loop` attribute always jumps back to 0, so looping is handled
 * here instead: play the first pass from the head to just before `end`, then
 * jump straight back to `start` for every subsequent pass. With `loop` off the
 * video pauses on the last frame (or exactly at `end`) instead of restarting.
 */
export function HeroBackgroundVideo({ src, poster, loop, start, end }: HeroBackgroundVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Read the latest settings from inside the animation loop without tearing
  // down and recreating the video element when the admin tweaks a number.
  const config = useRef({ loop, start, end });
  config.current = { loop, start, end };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let frame = 0;
    let disposed = false;

    const range = () =>
      normalizeVideoRange(video.duration, config.current.start, config.current.end);

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const schedule = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(tick);
    };

    const jumpToStart = () => {
      // Do not schedule from here: wait for `seeked`, otherwise the old
      // currentTime would immediately trigger the boundary again.
      video.currentTime = range().start;
      void video.play().catch(() => undefined);
    };

    const tick = () => {
      frame = 0;
      if (disposed) return;

      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const { end: endAt } = normalizeVideoRange(
        duration,
        config.current.start,
        config.current.end,
      );

      if (endAt > 0 && video.currentTime >= endAt - LOOP_GUARD_SECONDS) {
        if (config.current.loop) {
          jumpToStart();
        } else {
          video.pause();
          if (endAt < duration - LOOP_GUARD_SECONDS) video.currentTime = endAt;
          stop();
        }
        return;
      }

      if (!video.paused && !video.ended) schedule();
    };

    const onPlay = () => {
      stop();
      schedule();
    };

    const onEnded = () => {
      stop();
      if (config.current.loop) jumpToStart();
    };

    const onSeeked = () => {
      // Resume boundary checks once the jump back to the loop start lands.
      if (!video.paused && !video.ended) onPlay();
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('seeked', onSeeked);
    if (!video.paused && !video.ended) onPlay();

    return () => {
      disposed = true;
      stop();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      className="eb-hero-video pointer-events-none absolute inset-0 h-full w-full object-cover"
      src={src}
      poster={poster || undefined}
      autoPlay
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
