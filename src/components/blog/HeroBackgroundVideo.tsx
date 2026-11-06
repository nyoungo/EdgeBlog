import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialVideoTime,
  needsSecondDeck,
  normalizeVideoRange,
  videoSwapLead,
  type VideoRange,
} from '../../lib/hero-video';

interface HeroBackgroundVideoProps {
  src: string;
  poster?: string;
  loop: boolean;
  /** Loop range start in seconds. */
  start: number;
  /** Loop range end in seconds; 0 means the end of the clip. */
  end: number;
  /** Play the first pass from 0 instead of entering the loop range immediately. */
  firstFromStart: boolean;
}

interface DeckProps {
  src: string;
  poster?: string;
  loop: boolean;
  start: number;
  end: number;
  firstFromStart: boolean;
}

interface FrameTicket {
  cancel: () => void;
}

/** Treat positions within this distance of the end as "reached the end". */
const STOP_GUARD_SECONDS = 0.001;
const METADATA_TIMEOUT_MS = 6000;
const SEEK_TIMEOUT_MS = 2500;
const SWAP_WATCHDOG_MS = 1600;
const BASE_CLASS =
  'eb-hero-video pointer-events-none absolute inset-0 h-full w-full object-cover';

/** Keep background decks inline and prevent browsers from exposing optional media controls. */
function configureBackgroundVideo(video: HTMLVideoElement) {
  video.controls = false;
  video.removeAttribute('controls');
  video.setAttribute('playsinline', '');
  // Older iOS Safari versions use this prefixed attribute to avoid native fullscreen playback.
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('disableremoteplayback', '');
}

/** Schedule work on the presented frame, falling back to rAF where unsupported. */
function scheduleFrame(
  video: HTMLVideoElement,
  callback: (mediaTime: number) => void,
): FrameTicket {
  if (typeof video.requestVideoFrameCallback === 'function') {
    let live = true;
    const handle = video.requestVideoFrameCallback((_now, metadata) => {
      if (live) callback(metadata.mediaTime);
    });
    return {
      cancel: () => {
        live = false;
        video.cancelVideoFrameCallback?.(handle);
      },
    };
  }

  const handle = requestAnimationFrame(() => callback(video.currentTime));
  return { cancel: () => cancelAnimationFrame(handle) };
}

function scheduleRaf(callback: () => void): FrameTicket {
  const handle = requestAnimationFrame(callback);
  return { cancel: () => cancelAnimationFrame(handle) };
}

function waitForMetadata(video: HTMLVideoElement): Promise<boolean> {
  if (video.readyState >= 1 && Number.isFinite(video.duration)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
      resolve(ok);
    };
    const onReady = () => finish(true);
    const onError = () => finish(false);

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('error', onError);
    timer = window.setTimeout(() => finish(false), METADATA_TIMEOUT_MS);
  });
}

/** Seek while hidden, then report whether the decoder actually landed there. */
function seekVideo(video: HTMLVideoElement, time: number): Promise<boolean> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const target = Math.max(0, Math.min(time, Math.max(0, duration - 0.045)));
  if (!video.seeking && Math.abs(video.currentTime - target) < 0.01) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer = 0;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    timer = window.setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
    try {
      video.currentTime = target;
    } catch {
      finish(false);
    }
  }).then(
    (ok) => ok && !video.seeking && Math.abs(video.currentTime - target) < 0.08,
  );
}

/**
 * One-deck hero video for the common case: loop the whole clip natively or
 * play it once. Only a single <video> is mounted, so the browser fetches one
 * copy of the file and no hand-off machinery runs.
 */
function HeroBackgroundVideoSingle({
  src,
  poster,
  loop,
  start,
  end,
  firstFromStart,
}: DeckProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let disposed = false;
    let watchTicket: FrameTicket | null = null;
    let watchEpoch = 0;

    const durationOf = () =>
      Number.isFinite(video.duration) ? video.duration : 0;
    const rangeOf = () => normalizeVideoRange(durationOf(), start, end);

    const stopWatching = () => {
      watchEpoch += 1;
      watchTicket?.cancel();
      watchTicket = null;
    };

    const stopAtEnd = (endAt: number) => {
      video.pause();
      if (endAt < durationOf() - STOP_GUARD_SECONDS) {
        try {
          video.currentTime = endAt;
        } catch {
          /* keep the last decoded frame */
        }
      }
    };

    const startWatching = () => {
      stopWatching();
      if (disposed || loop || video.paused || video.ended) return;

      const range = rangeOf();
      if (!(range.end > 0 && range.end < durationOf() - STOP_GUARD_SECONDS)) return;

      const epoch = watchEpoch;
      const schedule = () => {
        if (disposed || epoch !== watchEpoch) return;
        watchTicket = scheduleFrame(video, (time) => {
          watchTicket = null;
          if (disposed || epoch !== watchEpoch) return;
          if (time >= range.end - STOP_GUARD_SECONDS || video.ended) {
            stopAtEnd(range.end);
            return;
          }
          if (video.paused || video.ended) return;
          schedule();
        });
      };

      schedule();
    };

    const onPlay = () => startWatching();
    video.addEventListener('play', onPlay);

    const boot = async () => {
      configureBackgroundVideo(video);
      video.muted = true;
      video.src = src;
      video.load();

      if (!(await waitForMetadata(video)) || disposed) return;

      const range = rangeOf();
      const entry = initialVideoTime(range, firstFromStart);
      if (entry > 0.001 && !(await seekVideo(video, entry))) return;
      if (disposed) return;

      try {
        await video.play();
      } catch {
        return;
      }
      if (disposed) return;

      startWatching();
    };

    void boot();

    return () => {
      disposed = true;
      stopWatching();
      video.removeEventListener('play', onPlay);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src, loop, start, end, firstFromStart]);

  return (
    <video
      ref={videoRef}
      className={`${BASE_CLASS} is-active`}
      poster={poster || undefined}
      muted
      playsInline
      preload="auto"
      loop={loop}
      aria-hidden="true"
      tabIndex={-1}
      data-hero-deck="a"
    />
  );
}

/**
 * Hero background video with a custom loop range.
 *
 * The visible decoder is never seeked while it is on screen. Two stacked decks
 * alternate instead: while one plays, the other is loaded and parked at the
 * loop start, hidden on top at 0.1% opacity so the browser keeps compositing it.
 * Shortly before the range ends the parked deck starts playing; on its first
 * presented frame the two decks swap. The cut therefore has no cross-fade, no
 * seek stall and no black frame.
 *
 * The second deck is only mounted after the first one has loaded and started
 * playing, so both copies of the file are never downloaded at the same time.
 */
function HeroBackgroundVideoDeck({
  src,
  poster,
  loop,
  start,
  end,
  firstFromStart,
}: DeckProps) {
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement | null>(null);
  const secondWaitRef = useRef<((el: HTMLVideoElement | null) => void) | null>(null);
  const [secondMounted, setSecondMounted] = useState(false);
  const config = useRef({ loop, start, end, firstFromStart });
  config.current = { loop, start, end, firstFromStart };
  const syncRef = useRef<(() => void) | null>(null);

  const attachSecond = useCallback((el: HTMLVideoElement | null) => {
    secondRef.current = el;
    const waiter = secondWaitRef.current;
    if (el && waiter) {
      secondWaitRef.current = null;
      waiter(el);
    }
  }, []);

  useEffect(() => {
    const first = firstRef.current;
    if (!first || !src) return;

    // A new source or first-pass rule restarts the hand-off from scratch: show
    // only the first deck again until it is ready.
    setSecondMounted(false);

    let disposed = false;
    let booted = false;
    let second: HTMLVideoElement | null = null;
    let standby: HTMLVideoElement = first;
    let secondAttached = false;
    let active = first;

    let watchTicket: FrameTicket | null = null;
    let watchEpoch = 0;
    let standbyTicket: FrameTicket | null = null;
    let standbyEpoch = 0;

    let swapping = false;
    let standbyPlaying = false;
    let standbyReady = false;
    let preparedKey = '';
    let prepToken = 0;
    let prepPromise: Promise<boolean> | null = null;
    let prepKey = '';
    let swapSeq = 0;
    let swapGuard = 0;
    let swapTimer = 0;

    function waitForSecond(): Promise<HTMLVideoElement | null> {
      if (secondRef.current) return Promise.resolve(secondRef.current);
      return new Promise((resolve) => {
        secondWaitRef.current = resolve;
      });
    }

    const durationOf = (deck: HTMLVideoElement) =>
      Number.isFinite(deck.duration) ? deck.duration : 0;

    function rangeOf(deck: HTMLVideoElement): VideoRange {
      return normalizeVideoRange(
        durationOf(deck),
        config.current.start,
        config.current.end,
      );
    }

    function rangeKey(deck: HTMLVideoElement): string {
      const range = rangeOf(deck);
      return `${range.start.toFixed(3)}:${range.end.toFixed(3)}`;
    }

    /** Raw config identity, usable before the standby deck has metadata. */
    function configRangeKey(): string {
      const { start: startAt, end: endAt } = config.current;
      return `${startAt.toFixed(3)}:${endAt.toFixed(3)}`;
    }

    function stopWatching() {
      watchEpoch += 1;
      watchTicket?.cancel();
      watchTicket = null;
    }

    function stopStandbyProbe() {
      standbyEpoch += 1;
      standbyTicket?.cancel();
      standbyTicket = null;
    }

    function stopSwapGuard() {
      if (swapGuard) cancelAnimationFrame(swapGuard);
      swapGuard = 0;
      if (swapTimer) window.clearTimeout(swapTimer);
      swapTimer = 0;
    }

    function stopVisibleAtEnd(deck: HTMLVideoElement, range: VideoRange) {
      deck.pause();
      const duration = durationOf(deck);
      if (range.end > 0 && range.end < duration - STOP_GUARD_SECONDS) {
        try {
          deck.currentTime = range.end;
        } catch {
          /* keep the last decoded frame */
        }
      }
    }

    function startWatching() {
      stopWatching();
      if (disposed || active.paused || active.ended) return;

      const deck = active;
      const epoch = watchEpoch;

      const schedule = () => {
        if (disposed || epoch !== watchEpoch || deck !== active) return;
        watchTicket = scheduleFrame(deck, (time) => {
          watchTicket = null;
          if (disposed || epoch !== watchEpoch || deck !== active) return;

          const cfg = config.current;
          const range = rangeOf(deck);

          if (cfg.loop) {
            if (range.end > 0 && time >= range.end - videoSwapLead(range)) {
              void beginSwap();
              return;
            }
          } else if (
            range.end > 0 &&
            (time >= range.end - STOP_GUARD_SECONDS || deck.ended)
          ) {
            stopVisibleAtEnd(deck, range);
            return;
          }

          if (deck.paused || deck.ended) return;
          schedule();
        });
      };

      schedule();
    }

    function disarmStandby() {
      if (!secondAttached) return;
      prepToken += 1;
      prepPromise = null;
      prepKey = '';
      standbyReady = false;
      preparedKey = '';
      standby.pause();
      standby.muted = true;
      standby.classList.remove('is-standby');
    }

    function prepareStandby(): Promise<boolean> {
      if (
        disposed ||
        !secondAttached ||
        !config.current.loop ||
        standbyPlaying
      ) {
        return Promise.resolve(false);
      }

      const effectiveKey = rangeKey(standby);
      if (standbyReady && preparedKey === effectiveKey) return Promise.resolve(true);

      const requestKey = configRangeKey();
      if (prepPromise && prepKey === requestKey) return prepPromise;

      const token = ++prepToken;
      const deck = standby;
      standbyReady = false;
      preparedKey = '';
      deck.classList.remove('is-standby');
      deck.muted = true;
      deck.pause();

      const promise = (async () => {
        if (!(await waitForMetadata(deck))) return false;
        if (disposed || token !== prepToken || deck !== standby) return false;

        const readyKey = rangeKey(deck);
        const { start: startAt } = rangeOf(deck);
        if (!(await seekVideo(deck, startAt))) return false;
        if (
          disposed ||
          token !== prepToken ||
          deck !== standby ||
          !config.current.loop ||
          standbyPlaying
        ) {
          return false;
        }

        deck.pause();
        deck.classList.remove('is-active');
        deck.classList.add('is-standby');
        standbyReady = true;
        preparedKey = readyKey;
        return true;
      })();

      prepPromise = promise;
      prepKey = requestKey;
      void promise.finally(() => {
        if (prepPromise === promise) {
          prepPromise = null;
          prepKey = '';
        }
      });
      return promise;
    }

    function waitForStandbyFrame(seq: number) {
      const deck = standby;
      const epoch = ++standbyEpoch;

      const invalid = () =>
        disposed ||
        seq !== swapSeq ||
        epoch !== standbyEpoch ||
        !swapping ||
        !standbyPlaying ||
        deck !== standby;

      const probe = () => {
        if (invalid()) return;

        if (deck.paused || deck.seeking || deck.readyState < 2) {
          standbyTicket = scheduleRaf(probe);
          return;
        }

        const { start: startAt } = rangeOf(deck);
        standbyTicket = scheduleFrame(deck, (time) => {
          standbyTicket = null;
          if (invalid()) return;
          if (time < startAt - 0.002) {
            probe();
            return;
          }
          commitSwap(seq);
        });
      };

      probe();
    }

    function playStandby(seq: number) {
      const deck = standby;
      standbyPlaying = true;
      standbyReady = false;
      preparedKey = '';

      const endAt = rangeOf(active).end;
      const guard = () => {
        swapGuard = 0;
        if (disposed || seq !== swapSeq || !swapping) return;
        if (active.currentTime >= endAt - STOP_GUARD_SECONDS || active.ended) {
          active.pause();
          return;
        }
        swapGuard = requestAnimationFrame(guard);
      };
      swapGuard = requestAnimationFrame(guard);

      swapTimer = window.setTimeout(() => {
        if (disposed || seq !== swapSeq || !swapping) return;
        failSwap(seq);
      }, SWAP_WATCHDOG_MS);

      waitForStandbyFrame(seq);
      void deck.play().catch(() => {
        if (disposed || seq !== swapSeq || !swapping) return;
        failSwap(seq);
      });
    }

    function commitSwap(seq: number) {
      if (disposed || seq !== swapSeq || !swapping) return;

      const outgoing = active;
      const incoming = standby;

      swapping = false;
      standbyPlaying = false;
      standbyReady = false;
      preparedKey = '';
      stopStandbyProbe();
      stopSwapGuard();

      outgoing.pause();
      incoming.classList.remove('is-standby');
      incoming.classList.add('is-active');
      outgoing.classList.remove('is-active', 'is-standby');

      active = incoming;
      standby = outgoing;

      if (active.paused) {
        void active.play().catch(() => undefined);
      }
      startWatching();
      void prepareStandby();
    }

    function recoverVisible() {
      const range = rangeOf(active);

      const resume = () => {
        if (disposed) return;
        active.removeEventListener('seeked', resume);
        window.clearTimeout(timer);
        if (!config.current.loop) return;
        void active.play().catch(() => undefined);
        startWatching();
        void prepareStandby();
      };

      active.addEventListener('seeked', resume, { once: true });
      const timer = window.setTimeout(resume, 1200);
      try {
        active.currentTime = range.start;
      } catch {
        resume();
        return;
      }
      if (!active.seeking && Math.abs(active.currentTime - range.start) < 0.01) {
        resume();
      }
    }

    function failSwap(seq: number) {
      if (disposed || seq !== swapSeq) return;

      swapping = false;
      standbyPlaying = false;
      standbyReady = false;
      preparedKey = '';
      prepToken += 1;
      stopStandbyProbe();
      stopSwapGuard();

      if (secondAttached) {
        standby.pause();
        standby.classList.remove('is-standby', 'is-active');
      }

      if (!config.current.loop) {
        active.pause();
        return;
      }

      // Last resort: a visible seek, only when the hidden hand-off could not
      // decode. It may hitch, but the loop still resumes.
      recoverVisible();
    }

    async function beginSwap() {
      if (disposed || !booted || swapping || standbyPlaying || !config.current.loop) {
        return;
      }

      if (!secondAttached) {
        // The hand-off deck is still being attached; keep the visible deck
        // playing until it is ready.
        startWatching();
        return;
      }

      swapping = true;
      const seq = ++swapSeq;
      stopWatching();
      stopSwapGuard();

      if (!(standbyReady && preparedKey === rangeKey(standby))) {
        active.pause();
        if (!(await prepareStandby())) {
          failSwap(seq);
          return;
        }
      }

      if (
        disposed ||
        seq !== swapSeq ||
        !swapping ||
        !config.current.loop ||
        !standbyReady ||
        preparedKey !== rangeKey(standby)
      ) {
        if (seq === swapSeq && !disposed && config.current.loop) failSwap(seq);
        return;
      }

      playStandby(seq);
    }

    function cancelSwap() {
      if (!swapping && !standbyPlaying) return false;
      swapSeq += 1;
      swapping = false;
      standbyPlaying = false;
      standbyReady = false;
      preparedKey = '';
      stopStandbyProbe();
      stopSwapGuard();
      if (secondAttached) {
        standby.pause();
        standby.classList.remove('is-standby', 'is-active');
      }
      return true;
    }

    function sync() {
      if (disposed || !booted) return;

      if (!config.current.loop) {
        const interrupted = cancelSwap();
        disarmStandby();

        if (interrupted) {
          const range = rangeOf(active);
          const duration = durationOf(active);
          if (
            active.paused &&
            range.end > 0 &&
            range.end < duration - STOP_GUARD_SECONDS
          ) {
            try {
              active.currentTime = range.end;
            } catch {
              /* keep the held frame */
            }
          }
        }

        if (!active.paused && !active.ended) startWatching();
        return;
      }

      if (swapping || standbyPlaying) return;

      if (active.ended) {
        void beginSwap();
        return;
      }

      const range = rangeOf(active);
      if (active.paused) {
        if (active.currentTime >= range.end - videoSwapLead(range)) {
          void beginSwap();
        }
        return;
      }

      startWatching();
      void prepareStandby();
    }

    const onPlay = (event: Event) => {
      if (disposed || !booted || swapping) return;
      if (event.currentTarget !== active) return;
      startWatching();
    };

    const onEnded = (event: Event) => {
      if (disposed || !booted || swapping) return;
      if (event.currentTarget !== active) return;
      if (config.current.loop) void beginSwap();
    };

    first.addEventListener('play', onPlay);
    first.addEventListener('ended', onEnded);

    const boot = async () => {
      first.classList.add('is-active');
      configureBackgroundVideo(first);
      first.muted = true;
      first.src = src;
      first.load();

      if (!(await waitForMetadata(first)) || disposed) return;

      const range = rangeOf(first);
      const entry = initialVideoTime(range, config.current.firstFromStart);
      if (entry > 0.001 && !(await seekVideo(first, entry))) return;
      if (disposed) return;

      try {
        await first.play();
      } catch {
        return;
      }
      if (disposed) return;

      booted = true;
      startWatching();

      // Wait until the visible deck is already playing before mounting and
      // loading the second one. Both copies must never download together.
      setSecondMounted(true);
      const next = await waitForSecond();
      if (!next || disposed) return;

      second = next;
      standby = next;
      secondAttached = true;
      configureBackgroundVideo(next);
      next.muted = true;
      next.src = src;
      next.load();
      next.addEventListener('play', onPlay);
      next.addEventListener('ended', onEnded);

      startWatching();
      void prepareStandby();

      if (active.ended) void beginSwap();
    };

    void boot();
    syncRef.current = sync;

    return () => {
      disposed = true;
      prepToken += 1;
      swapSeq += 1;
      stopWatching();
      stopStandbyProbe();
      stopSwapGuard();

      const pending = secondWaitRef.current;
      if (pending) {
        secondWaitRef.current = null;
        pending(null);
      }

      first.removeEventListener('play', onPlay);
      first.removeEventListener('ended', onEnded);
      first.pause();
      first.classList.remove('is-active', 'is-standby');
      first.removeAttribute('src');
      first.load();

      if (second) {
        second.removeEventListener('play', onPlay);
        second.removeEventListener('ended', onEnded);
        second.pause();
        second.classList.remove('is-active', 'is-standby');
        second.removeAttribute('src');
        second.load();
      }

      syncRef.current = null;
    };
  }, [src, firstFromStart]);

  // Loop range changes are live: re-arm the hidden deck without restarting the
  // visible one. `firstFromStart` is handled by the effect above because it
  // changes where the very first pass begins.
  useEffect(() => {
    syncRef.current?.();
  }, [loop, start, end]);

  return (
    <>
      <video
        ref={firstRef}
        className={BASE_CLASS}
        poster={poster || undefined}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        data-hero-deck="a"
      />
      {secondMounted && (
        <video
          ref={attachSecond}
          className={BASE_CLASS}
          poster={poster || undefined}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          data-hero-deck="b"
        />
      )}
    </>
  );
}

/**
 * Hero background video.
 *
 * A plain loop (start = end = 0) or one-shot playback uses a single <video>.
 * A custom loop range mounts a second, hidden deck for the seamless wrap, and
 * that deck is only loaded after the first one is already playing.
 */
export function HeroBackgroundVideo({
  src,
  poster,
  loop,
  start,
  end,
  firstFromStart,
}: HeroBackgroundVideoProps) {
  if (needsSecondDeck(loop, start, end)) {
    return (
      <HeroBackgroundVideoDeck
        src={src}
        poster={poster}
        loop={loop}
        start={start}
        end={end}
        firstFromStart={firstFromStart}
      />
    );
  }

  return (
    <HeroBackgroundVideoSingle
      src={src}
      poster={poster}
      loop={loop}
      start={start}
      end={end}
      firstFromStart={firstFromStart}
    />
  );
}
