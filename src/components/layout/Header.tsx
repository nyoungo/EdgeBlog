import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { HeaderSettings, NavAlign } from '@shared/types';
import { IconButton, IconLink } from '../ui/IconButton';
import { ThemeToggle } from '../ui/ThemeToggle';
import { cn } from '../../lib/utils';
import { useSettings } from '../../providers/SettingsProvider';
import { useAuth } from '../../providers/AuthProvider';

type NavStyle = HeaderSettings['style'];

/** Width of the desktop vertical sidebar nav (16rem, matches RootLayout's `lg:pl-64`). */
const LEFT_NAV_WIDTH = '16rem';

/** Link classes for the three navigation styles. */
function navLinkClass(style: NavStyle, active: boolean): string {
  if (style === 'minimal') {
    return cn(
      'relative px-1 py-2 text-sm font-medium transition-colors',
      active ? 'text-fg' : 'text-muted hover:text-fg',
    );
  }
  if (style === 'pill') {
    return cn(
      'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
      active ? 'bg-fg/[0.08] text-fg' : 'text-muted hover:bg-fg/[0.05] hover:text-fg',
    );
  }
  // default: 现代胶囊导航项,不再用下划线。
  return cn(
    'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
    active ? 'bg-fg/[0.07] text-fg' : 'text-muted hover:bg-fg/5 hover:text-fg',
  );
}

/** Row classes for the vertical sidebar nav; honours style + align. */
function verticalNavItemClass(style: NavStyle, align: NavAlign, active: boolean): string {
  const justify =
    align === 'center' ? 'justify-center text-center' : align === 'right' ? 'justify-end text-right' : 'justify-start';
  const rowBase = 'flex w-full items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors';
  if (style === 'pill') {
    return cn(
      'flex w-full items-center rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
      justify,
      active ? 'bg-fg/[0.08] text-fg' : 'text-muted hover:bg-fg/5 hover:text-fg',
    );
  }
  return cn(
    rowBase,
    justify,
    active ? 'bg-fg/[0.06] text-fg' : 'text-muted hover:bg-fg/[0.04] hover:text-fg',
  );
}

function NavItems({ vertical, vt, onNavigate }: { vertical: boolean; vt: boolean; onNavigate?: () => void }) {
  const { settings } = useSettings();
  const { style, align, navColor } = settings.layout.header;

  const itemStyle = navColor ? { color: navColor } : undefined;
  const itemClass = (active: boolean) =>
    vertical ? verticalNavItemClass(style, align, active) : navLinkClass(style, active);

  return (
    <>
      {settings.navigation.map((item) =>
        item.external ? (
          <a
            key={item.id}
            href={item.href}
            target={item.newTab ? '_blank' : undefined}
            rel={item.newTab ? 'noopener noreferrer' : undefined}
            onClick={onNavigate}
            className={itemClass(false)}
            style={itemStyle}
          >
            {item.label}
          </a>
        ) : (
          <NavLink
            key={item.id}
            to={item.href}
            viewTransition={vt}
            onClick={onNavigate}
            className={({ isActive }) => itemClass(isActive)}
            style={itemStyle}
            end={item.href === '/'}
          >
            {item.label}
          </NavLink>
        ),
      )}
    </>
  );
}

/**
 * The header switches to a white-on-media treatment only while a hero section
 * is actually behind it. A scroll threshold alone used to flip the bar after
 * 8px; this observes the hero's bottom edge instead.
 */
function useHeroOverlap(height: number) {
  const [over, setOver] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const hero = document.querySelector('[data-hero]');
      if (!hero) {
        setOver(false);
        return;
      }
      const rect = hero.getBoundingClientRect();
      // 只有英雄区真的盖住顶栏区域时才切换成压媒体的白字。
      setOver(rect.top < height && rect.bottom > 0);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [height, pathname]);

  return over;
}

export function Header() {
  const { settings } = useSettings();
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuId = 'eb-mobile-menu';

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Esc closes the menu and returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const first = menuRef.current?.querySelector<HTMLElement>('a[href], button');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const { site, features, layout } = settings;
  const header = layout.header;
  const headerHeight = Number.parseInt(header.height || '64', 10) || 64;

  useEffect(() => {
    document.documentElement.style.setProperty('--eb-header-h', header.height || '64px');
  }, [header.height]);

  const overMedia = useHeroOverlap(headerHeight);
  const logoText = site.logo.text || site.name;
  const vt = features.viewTransitions;

  const logoStyle: CSSProperties | undefined = header.logoColor ? { color: header.logoColor } : undefined;
  const navStyle: CSSProperties | undefined = header.navColor ? { color: header.navColor } : undefined;
  const actionStyle = header.actionColor
    ? ({ '--eb-header-action-color': header.actionColor } as CSSProperties)
    : undefined;

  const barStyle: CSSProperties = { height: header.height || '64px' };
  const positionClass =
    header.position === 'fixed'
      ? 'fixed inset-x-0 top-0'
      : header.position === 'sticky'
        ? 'sticky top-0'
        : 'relative';

  // Over a hero we go fully transparent + white; everywhere else a transparent
  // setting falls back to glass so the bar never disappears on a plain page.
  const transparentNow = header.transparentOnTop && overMedia && header.position !== 'left';
  const surfaceClass = transparentNow
    ? 'eb-header-on-media border-transparent bg-transparent'
    : header.background === 'glass' || header.background === 'transparent'
      ? 'eb-glass-bar'
      : 'bg-surface/95 backdrop-blur-md';

  const renderLogo = (className?: string) => (
    <Link
      to="/"
      className={cn('flex items-center gap-2.5 text-fg no-underline', className)}
      style={logoStyle}
      onClick={() => setOpen(false)}
      viewTransition={vt}
    >
      {site.logo.type === 'image' && site.logo.imageUrl ? (
        <img src={site.logo.imageUrl} alt={site.name} className="h-7 w-auto" />
      ) : (
        <>
          <span className="eb-logo-mark flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-bold text-brand-fg">
            {logoText.slice(0, 1).toUpperCase()}
          </span>
          <span className="eb-logo-text text-[15px] font-semibold">{logoText}</span>
        </>
      )}
    </Link>
  );

  const actions: ReactNode = (
    <>
      {features.search && <IconLink to="/search" icon="search" label="搜索" />}
      <ThemeToggle />
      {user ? <IconLink to="/admin" icon="dashboard" label="管理后台" /> : null}
      <IconButton
        icon={open ? 'close' : 'menu'}
        label={open ? '关闭菜单' : '打开菜单'}
        onClick={() => setOpen((v) => !v)}
        className="md:hidden"
      />
    </>
  );

  const mobileMenu: ReactNode = open && (
    <div
      ref={menuRef}
      id={menuId}
      className={cn(
        'md:hidden',
        header.background === 'glass' || header.background === 'transparent'
          ? 'eb-glass-panel border-x-0 border-b-0'
          : 'bg-surface shadow-card',
      )}
    >
      <nav className="eb-header-nav container-page flex flex-col py-2">
        {settings.navigation.map((item) =>
          item.external ? (
            <a
              key={item.id}
              href={item.href}
              target={item.newTab ? '_blank' : undefined}
              rel={item.newTab ? 'noopener noreferrer' : undefined}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-fg/5 hover:text-fg"
              style={navStyle}
            >
              {item.label}
            </a>
          ) : (
            <NavLink
              key={item.id}
              to={item.href}
              end={item.href === '/'}
              viewTransition={vt}
              onClick={() => setOpen(false)}
              style={navStyle}
              className={({ isActive }) =>
                cn(
                  'rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-fg/5',
                  isActive ? 'text-fg' : 'text-muted',
                )
              }
            >
              {item.label}
            </NavLink>
          ),
        )}
        {user && (
          <NavLink
            to="/admin"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-fg/5 hover:text-fg"
          >
            管理后台
          </NavLink>
        )}
      </nav>
    </div>
  );

  // Vertical sidebar nav on desktop, top bar on smaller screens.
  if (header.position === 'left') {
    const justify =
      header.align === 'center' ? 'justify-center' : header.align === 'right' ? 'justify-end' : 'justify-start';
    return (
      <>
        <aside
          className="eb-glass-panel fixed inset-y-0 left-0 z-40 hidden flex-col rounded-none border-y-0 border-l-0 lg:flex"
          style={{ width: LEFT_NAV_WIDTH }}
        >
          <div className={cn('flex shrink-0 items-center px-5', justify)} style={barStyle}>
            {renderLogo()}
          </div>
          <nav className="eb-header-nav flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
            <NavItems vertical vt={vt} />
          </nav>
          <div
            className={cn('eb-header-actions flex shrink-0 items-center gap-1 bg-surface-2/50 px-3 py-3', justify)}
            style={actionStyle}
          >
            {actions}
          </div>
        </aside>

        <header
          className={cn('sticky top-0 z-40 w-full border-b transition-colors lg:hidden', surfaceClass)}
          data-over-media={transparentNow ? 'true' : 'false'}
        >
          <div className="container-page flex items-center gap-4" style={barStyle}>
            {renderLogo()}
            <nav
              className={cn(
                'eb-header-nav hidden items-center gap-1 md:flex',
                header.style === 'pill' &&
                  (transparentNow
                    ? 'rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur-md'
                    : 'rounded-full border border-border bg-surface-2/70 p-1 backdrop-blur-md'),
              )}
            >
              <NavItems vertical={false} vt={vt} />
            </nav>
            <div className="eb-header-actions ml-auto flex items-center gap-0.5" style={actionStyle}>
              {actions}
            </div>
          </div>
          {mobileMenu}
        </header>
      </>
    );
  }

  const centered = header.align === 'center';
  const barInnerClass = cn('container-page flex items-center gap-4', centered && 'md:grid md:grid-cols-[1fr_auto_1fr]');

  const navClass = cn(
    'eb-header-nav hidden items-center md:flex',
    header.style === 'pill' && 'eb-nav-pill',
    header.style === 'pill'
      ? transparentNow
        ? 'gap-1 rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur-md'
        : 'gap-1 rounded-full border border-border bg-surface-2/70 p-1 backdrop-blur-md'
      : 'gap-5',
    !centered && header.align === 'left' && 'mr-auto',
    !centered && header.align === 'right' && 'ml-auto',
    centered && 'md:justify-self-center',
  );

  const actionsClass = cn(
    'eb-header-actions flex items-center gap-0.5',
    centered ? 'ml-auto md:ml-0 md:justify-self-end' : 'ml-auto',
  );

  return (
    <>
      <header
        className={cn(positionClass, 'z-40 w-full transition-colors', surfaceClass)}
        data-over-media={transparentNow ? 'true' : 'false'}
        style={{ '--eb-header-h': header.height || '64px' } as CSSProperties}
      >
        <div className={barInnerClass} style={barStyle}>
          {renderLogo(centered ? 'md:justify-self-start' : undefined)}

          <nav className={navClass}>
            <NavItems vertical={false} vt={vt} />
          </nav>

          <div className={actionsClass} style={actionStyle}>
            {actions}
          </div>
        </div>

        {mobileMenu}
      </header>

      {header.position === 'fixed' && <div style={barStyle} aria-hidden="true" />}
    </>
  );
}
