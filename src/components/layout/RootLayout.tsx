import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../ui/icons';
import { cn } from '../../lib/utils';
import { injectInto } from '../../lib/dom-inject';
import { useScrolled } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { Header } from './Header';
import { Footer } from './Footer';
import { MusicPlayerHost } from '../music/MusicPlayerHost';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function BackToTop() {
  const visible = useScrolled(500);
  const { settings } = useSettings();
  if (!settings.features.backToTop) return null;
  const leftNav = settings.layout.header.position === 'left';
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="回到顶部"
      className={cn(
        'fixed bottom-5 left-5 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-pop transition-all hover:text-fg',
        leftNav && 'lg:left-[17rem]',
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

export function RootLayout() {
  const { settings } = useSettings();
  // A left nav docks a fixed sidebar on lg+; shift the content column to match.
  const leftNav = settings.layout.header.position === 'left';
  return (
    <div className={cn('flex min-h-dvh flex-col', leftNav && 'lg:pl-64')}>
      <ScrollToTop />
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
