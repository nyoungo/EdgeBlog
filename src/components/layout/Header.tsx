import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { HeaderSettings, NavAlign } from '@shared/types';
import { buttonStyles } from '../ui/Button';
import { Icon } from '../ui/icons';
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
      'relative px-3 py-2 text-sm font-medium transition-colors',
      active ? 'text-fg' : 'text-muted hover:text-fg',
    );
  }
  if (style === 'pill') {
    return cn(
      'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
      active ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
    );
  }
  return cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-2 hover:text-fg',
    active ? 'text-fg' : 'text-muted',
  );
}

/** Row classes for the vertical sidebar nav; honours style + align. */
function verticalNavItemClass(style: NavStyle, align: NavAlign, active: boolean): string {
  const justify =
    align === 'center' ? 'justify-center text-center' : align === 'right' ? 'justify-end text-right' : 'justify-start';
  const rowBase = 'flex w-full items-center rounded-md px-3 py-2 text-sm font-medium transition-colors';
  if (style === 'minimal') {
    return cn(rowBase, justify, active ? 'text-fg' : 'text-muted hover:text-fg');
  }
  if (style === 'pill') {
    return cn(
      'flex w-full items-center rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
      justify,
      active ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
    );
  }
  return cn(rowBase, justify, active ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg');
}

function NavItems({ vertical, vt, onNavigate }: { vertical: boolean; vt: boolean; onNavigate?: () => void }) {
  const { settings } = useSettings();
  const { style, align, navColor } = settings.layout.header;

  // 自定义导航文字颜色：留空时沿用主题的 active / muted 配色。
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

export function Header() {
  const { settings } = useSettings();
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuId = 'eb-mobile-menu';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the drawer whenever the route changes (e.g. browser back), so it can
  // never linger open over a different page.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Esc closes the menu and returns focus to the trigger; opening moves focus
  // into the menu so keyboard/screen-reader users are not left behind.
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

  // Expose the configured bar height so in-page anchors (headings, TOC links)
  // can offset themselves below a sticky/fixed header instead of hiding under it.
  useEffect(() => {
    document.documentElement.style.setProperty('--eb-header-h', header.height || '64px');
  }, [header.height]);
  const logoText = site.logo.text || site.name;
  const vt = features.viewTransitions;

  // 顶栏三个可自定义颜色：留空时跟随主题。
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

  const transparentNow = header.transparentOnTop && !scrolled;
  // 透明顶栏直接压在英雄区/正文上,只靠文字阴影在纯黑或纯白背景上并不够稳;
  // 额外叠一层主题色渐变(见 .eb-header-scrim),明暗模式都能拉回对比度。
  const transparentBar = transparentNow || header.background === 'transparent';
  const surfaceClass = transparentBar
    ? 'border-transparent bg-transparent'
    : header.background === 'glass'
      ? 'border-border eb-glass'
      : 'border-border bg-bg';
  // 左侧竖排导航旁边始终是正文,不能真的透明,否则文字会和内容叠在一起。
  const asideSurfaceClass = transparentBar ? 'border-transparent eb-glass' : surfaceClass;

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
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg">
            {logoText.slice(0, 1).toUpperCase()}
          </span>
          <span className="eb-logo-text text-base font-semibold tracking-tight">{logoText}</span>
        </>
      )}
    </Link>
  );

  const actions: ReactNode = (
    <>
      {features.search && (
        <Link to="/search" className={buttonStyles({ variant: 'ghost', size: 'icon-sm' })} aria-label="搜索" title="搜索">
          <Icon name="search" size={18} />
        </Link>
      )}
      <ThemeToggle />
      {user ? (
        <Link
          to="/admin"
          className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          aria-label="管理后台"
          title="管理后台"
        >
          <Icon name="dashboard" size={15} />
          {/* Icon-only on phones — previously the entry was hidden entirely, so
              mobile owners had to type /admin by hand. */}
          <span className="hidden sm:inline">后台</span>
        </Link>
      ) : null}
      <button
        ref={toggleRef}
        type="button"
        className={buttonStyles({ variant: 'ghost', size: 'icon-sm', className: 'md:hidden' })}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '关闭菜单' : '打开菜单'}
        aria-expanded={open}
        aria-controls={menuId}
      >
        <Icon name={open ? 'close' : 'menu'} size={20} />
      </button>
    </>
  );

  const mobileMenu: ReactNode = open && (
    <div
      ref={menuRef}
      id={menuId}
      className={cn(
        'border-t border-border md:hidden',
        header.background === 'glass' || header.background === 'transparent' ? 'eb-glass' : 'bg-bg',
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
              className="rounded-md px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
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
                  'rounded-md px-3 py-2.5 text-sm font-medium hover:bg-surface-2',
                  isActive ? 'text-brand' : 'text-muted',
                )
              }
            >
              {item.label}
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );

  // Vertical sidebar nav on desktop, top bar on smaller screens.
  if (header.position === 'left') {
    const justify =
      header.align === 'center' ? 'justify-center' : header.align === 'right' ? 'justify-end' : 'justify-start';
    const mutedEdge = transparentNow || header.background === 'transparent';
    return (
      <>
        <aside
          className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col border-r lg:flex', asideSurfaceClass)}
          style={{ width: LEFT_NAV_WIDTH }}
        >
          <div className={cn('flex shrink-0 items-center px-5', justify)} style={barStyle}>
            {renderLogo()}
          </div>
          <nav className="eb-header-nav flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
            <NavItems vertical vt={vt} />
          </nav>
          <div
            className={cn(
              'eb-header-actions flex shrink-0 items-center gap-1 border-t px-3 py-3',
              mutedEdge ? 'border-transparent' : 'border-border',
              justify,
            )}
            style={actionStyle}
          >
            {actions}
          </div>
        </aside>

        <header className={cn('sticky top-0 z-40 w-full border-b transition-colors lg:hidden', surfaceClass, transparentBar && 'eb-header-scrim')}>
          <div className="container-page flex items-center gap-4" style={barStyle}>
            {renderLogo()}
            <nav
              className={cn(
                'eb-header-nav hidden items-center gap-1 md:flex',
                header.style === 'pill' && 'rounded-full border border-border bg-surface-2/90 p-1 backdrop-blur-sm',
              )}
            >
              <NavItems vertical={false} vt={vt} />
            </nav>
            <div className="eb-header-actions ml-auto flex items-center gap-1" style={actionStyle}>
              {actions}
            </div>
          </div>
          {mobileMenu}
        </header>
      </>
    );
  }

  const centered = header.align === 'center';

  // For "center" we switch to a 3-column grid at md+ so the nav is centred in
  // the bar itself (not just in the space left over by the logo/actions).
  const barInnerClass = cn('container-page flex items-center gap-4', centered && 'md:grid md:grid-cols-[1fr_auto_1fr]');

  const navClass = cn(
    'eb-header-nav hidden items-center md:flex',
    header.style === 'pill' ? 'gap-1 rounded-full border border-border bg-surface-2/90 p-1 backdrop-blur-sm' : 'gap-1',
    !centered && header.align === 'left' && 'mr-auto',
    !centered && header.align === 'right' && 'ml-auto',
    centered && 'md:justify-self-center',
  );

  const actionsClass = cn('flex items-center gap-1', centered ? 'ml-auto md:ml-0 md:justify-self-end' : 'ml-auto');

  return (
    <>
      <header className={cn(positionClass, 'z-40 w-full border-b transition-colors', surfaceClass, transparentBar && 'eb-header-scrim')}>
        <div className={barInnerClass} style={barStyle}>
          {renderLogo(centered ? 'md:justify-self-start' : undefined)}

          <nav className={navClass}>
            <NavItems vertical={false} vt={vt} />
          </nav>

          <div className={cn(actionsClass, 'eb-header-actions')} style={actionStyle}>
            {actions}
          </div>
        </div>

        {mobileMenu}
      </header>

      {header.position === 'fixed' && <div style={barStyle} aria-hidden="true" />}
    </>
  );
}
