/** Treat positions within this distance of the end as "reached the end". */
export const VIDEO_RANGE_EPSILON = 0.04;

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
