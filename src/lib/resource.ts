/** Tiny shared caches for data several widgets ask for at the same time. */
import type { Tag } from '@shared/types';
import { api } from './api';

const TAG_TTL_MS = 60_000;

let tagsPromise: Promise<Tag[]> | null = null;
let tagsFetchedAt = 0;

/**
 * Shared `/tags` request.
 *
 * The sidebar, the home "tags" module, the post list filter and the tag index
 * all mount together on the same navigation and used to fire four identical
 * requests. One in-flight promise is reused, and the result is kept briefly so
 * a quick route change does not refetch either.
 */
export function fetchTags(): Promise<Tag[]> {
  const now = Date.now();
  if (tagsPromise && now - tagsFetchedAt < TAG_TTL_MS) return tagsPromise;

  tagsFetchedAt = now;
  tagsPromise = api
    .get<Tag[]>('/tags')
    .then((res) => res.data)
    .catch((err: unknown) => {
      // Never cache a failure: the next consumer should get a real retry.
      tagsPromise = null;
      tagsFetchedAt = 0;
      throw err;
    });
  return tagsPromise;
}

/** Drop the cached list (e.g. after the admin edits tags). */
export function invalidateTags(): void {
  tagsPromise = null;
  tagsFetchedAt = 0;
}
