import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../ui/icons';
import { cn } from '../../lib/utils';
import { injectInto } from '../../lib/dom-inject';
import { useScrolled } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { Header } from './Header';
import { Footer } from './Footer';
import { MusicPlayerHost } from '../music/MusicPlayerHost';

function ScrollToTop() {
  const { pathname, search } = useLocation();
  // Pagination lives in the query string, so pathname alone misses it: picking
  // page 2 used to leave the viewport parked at the bottom of the old list.
  const page = new URLSearchParams(search).get('page') ?? '1';
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, page]);
  return null;
}

function BackToTop() {
  const visible = useScrolled(500);
  const { settings } = useSettings();
  if (!settings.features.backToTop) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="回到顶部"
      className={cn(
        'fixed bottom-5 right-5 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-pop transition-all hover:text-fg',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
      )}
    >
      <Icon name="arrowUp" size={18} />
    </button>
  );
}

function FooterHtml() {
  const { settings } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const html = settings.advanced.footerHtml;

  useEffect(() => {
    if (ref.current) injectInto(ref.current, html ?? '');
  }, [html]);

  if (!html) return null;
  return <div ref={ref} className="container-page py-4 text-center text-xs text-faint" />;
}

/**
 * ⌘K / Ctrl-K and `/` used to work only while the search page itself was
 * mounted. Hoisting the listener into the layout makes them global: from any
 * page they jump to `/search`, where the input already carries `autoFocus`.
 */
function GlobalSearchShortcut() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing =
        Boolean(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) || Boolean(el?.isContentEditable);
      const isPalette = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);
      const isSlash = e.key === '/' && !typing;
      if (!isPalette && !isSlash) return;

      if (pathname !== '/search') {
        if (isSlash || isPalette) e.preventDefault();
        navigate('/search');
        return;
      }
      // Already on the search page: focus the field (the page also listens,
      // but this keeps the behaviour identical for the modifier shortcut).
      document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, pathname]);

  return null;
}

export function RootLayout() {
  const { settings } = useSettings();
  // A left nav docks a fixed sidebar on lg+; shift the content column to match.
  const leftNav = settings.layout.header.position === 'left';
  return (
    <div className={cn('flex min-h-dvh flex-col', leftNav && 'lg:pl-64')}>
      <ScrollToTop />
      <GlobalSearchShortcut />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <FooterHtml />
      <Footer />
      <BackToTop />
      <MusicPlayerHost />
    </div>
  );
}
