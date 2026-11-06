/** Treat positions within this distance of the end as "reached the end". */
export const VIDEO_RANGE_EPSILON = 0.04;

/** Seconds before the cut where the standby deck is already playing. */
export const VIDEO_SWAP_LEAD_SECONDS = 0.04;

export interface VideoRange {
  start: number;
  end: number;
}

/**
 * Normalize the configured loop window against the real clip duration.
 *
 * `end = 0` means "play to the end of the clip". Empty, negative or inverted
 * windows fall back to the whole clip so a bad setting cannot make the video
 * loop in place forever.
 */
export function normalizeVideoRange(duration: number, start: number, end: number): VideoRange {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const rawStart = Number.isFinite(start) ? Math.max(0, start) : 0;
  const rawEnd = Number.isFinite(end) && end > 0 ? end : safeDuration;

  if (safeDuration <= 0) return { start: 0, end: rawEnd };

  const endAt = Math.min(rawEnd, safeDuration);
  // An empty or near-zero window would loop in place; use the whole clip.
  if (rawEnd <= rawStart || rawStart >= endAt - VIDEO_RANGE_EPSILON) {
    return { start: 0, end: safeDuration };
  }
  return { start: rawStart, end: endAt };
}

/**
 * Whether the hero needs a second hidden deck for a seamless custom loop.
 *
 * Only a looping sub-range (or a range that ends before the clip does) needs
 * the hand-off deck. A full-clip loop (`start = end = 0`), one-shot playback,
 * and inverted/empty windows (which fall back to the whole clip) can all use a
 * single native <video>.
 */
export function needsSecondDeck(loop: boolean, start: number, end: number): boolean {
  if (!loop) return false;

  const startAt = Number.isFinite(start) ? Math.max(0, start) : 0;
  const endAt = Number.isFinite(end) ? Math.max(0, end) : 0;
  if (startAt === 0 && endAt === 0) return false;
  if (endAt > 0 && endAt <= startAt) return false;
  return true;
}

/**
 * Where the very first pass starts. "From the beginning" means the clip head;
 * otherwise we skip the intro and enter the loop range immediately.
 */
export function initialVideoTime(range: VideoRange, firstFromStart: boolean): number {
  return firstFromStart ? 0 : range.start;
}

/**
 * How early to start the hidden deck before cutting. The lead is capped at a
 * quarter of the loop so very short ranges still get a usable guard, and at
 * 40 ms (about two 60 fps frames) so the visible deck never loses much tail.
 */
export function videoSwapLead(range: VideoRange): number {
  const segment = Math.max(0, range.end - range.start);
  return Math.min(VIDEO_SWAP_LEAD_SECONDS, segment / 4);
}
