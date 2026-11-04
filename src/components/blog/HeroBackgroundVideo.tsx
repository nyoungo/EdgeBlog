import { useEffect, useRef } from 'react';
import { VIDEO_RANGE_EPSILON, normalizeVideoRange } from '../../lib/hero-video';

interface HeroBackgroundVideoProps {
  src: string;
  poster?: string;
  loop: boolean;
  /** Loop range start in seconds. The first pass always starts at 0. */
  start: number;
  /** Loop range end in seconds; 0 means the end of the clip. */
  end: number;
}

/** Treat positions within this distance of the end as "reached the end". */
const END_EPSILON = VIDEO_RANGE_EPSILON;
/**
 * Hero background video with an optional custom loop range.
 *
 * The native `loop` attribute always jumps back to 0, so looping is handled
 * here instead: play the first pass from the head to `end`, then jump back to
 * `start` for every subsequent pass. With `loop` off the video pauses on the
 * last frame (or exactly at `end`) instead of restarting.
 */
export function HeroBackgroundVideo({ src, poster, loop, start, end }: HeroBackgroundVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Read the latest settings from inside the animation loop without tearing
  // down and recreating the video element when the admin tweaks a number.
  const config = useRef({ loop, start, end });
  config.current = { loop, start, end };

  useEffect(() => {
    const video = videoRef.current;
    // `src` is part of the dependency list: a new source needs fresh listeners.
    if (!video || !src) return;

    let frame = 0;
    let disposed = false;

    const range = () =>
      normalizeVideoRange(video.duration, config.current.start, config.current.end);

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const restart = () => {
      video.currentTime = range().start;
      void video.play().catch(() => undefined);
    };

    const tick = () => {
      frame = 0;
      if (disposed) return;
      const { end: endAt } = range();
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      // When the range reaches the natural end, let `ended` fire so the final
      // frames are not cut off by the ~40ms boundary tolerance.
      const fullClip = duration > 0 && endAt >= duration - END_EPSILON;
      if (!fullClip && endAt > 0 && video.currentTime >= endAt) {
        if (config.current.loop) {
          restart();
        } else {
          video.pause();
          video.currentTime = endAt;
        }
        return;
      }
      if (!video.paused && !video.ended) frame = requestAnimationFrame(tick);
    };

    const onPlay = () => {
      stop();
      frame = requestAnimationFrame(tick);
    };
    const onEnded = () => {
      stop();
      if (config.current.loop) restart();
    };
    const onSeeked = () => {
      // Resume the boundary check after a loop seek.
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
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
