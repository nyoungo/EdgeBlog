import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (next: T | null) => void;
}

/** Run an async loader on mount and whenever `deps` change. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

/**
 * 订阅 CSS 媒体查询。
 *
 * `useSyncExternalStore` 在首次渲染时同步读取真实结果，因此移动端不会先渲染
 * 视频再由 effect 收起来（那会白白发起一次视频请求）。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Debounce a rapidly-changing value (e.g. a search input). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Set `document.title`, optionally appending the site name. */
export function useDocumentTitle(title?: string | null, siteName?: string | null): void {
  useEffect(() => {
    if (!title) return;
    document.title = siteName && siteName !== title ? `${title} · ${siteName}` : title;
  }, [title, siteName]);
}

/**
 * Manage `<meta name="description">`.
 *
 * The shell ships one description for the whole site; a route that overrides it
 * must put it back when the user navigates away, otherwise the home page keeps
 * advertising the previous article's summary to crawlers and share sheets.
 */
export function useMetaDescription(description?: string | null): void {
  const previous = useRef<string | null>(null);
  const captured = useRef(false);

  useEffect(() => {
    let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'description';
      document.head.appendChild(tag);
    }
    if (!captured.current) {
      previous.current = tag.getAttribute('content');
      captured.current = true;
    }
    tag.content = description ?? previous.current ?? '';
  }, [description]);

  useEffect(() => {
    return () => {
      if (!captured.current) return;
      const tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (tag && previous.current !== null) tag.content = previous.current;
      captured.current = false;
    };
  }, []);
}

/** True once the page has scrolled past `threshold` pixels. */
export function useScrolled(threshold = 400): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/** Dismiss a popover when clicking outside the referenced element. */
export function useClickOutside<T extends HTMLElement>(onOutside: () => void, active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onOutside, active]);
  return ref;
}

/**
 * Guard against losing unsaved work.
 *
 * `beforeunload` covers reloads/tab closes. React Router's declarative
 * `<BrowserRouter>` (unlike a data router) has no `useBlocker`, so we also
 * intercept clicks on internal links in the capture phase: if the editor is
 * dirty and the user cancels the confirm, `stopPropagation` prevents the
 * `<Link>`'s handler from navigating.
 */
export function useUnsavedChangesGuard(dirty: boolean, message = '有未保存的修改,确定离开吗?'): void {
  const messageRef = useRef(message);
  messageRef.current = message;

  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target === '_blank' || target.hasAttribute('download')) return;
      const href = target.getAttribute('href') ?? '';
      if (!href || href.startsWith('#')) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same path + query (e.g. an in-page anchor link) is not a real nav.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(messageRef.current)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}
