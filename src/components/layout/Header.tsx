import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
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
  const { style, align } = settings.layout.header;

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
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const { site, features, layout } = settings;
  const header = layout.header;
  const logoText = site.logo.text || site.name;
  const vt = features.viewTransitions;

  const barStyle: CSSProperties = { height: header.height || '64px' };
  const positionClass =
    header.position === 'fixed'
      ? 'fixed inset-x-0 top-0'
      : header.position === 'sticky'
        ? 'sticky top-0'
        : 'relative';

  const transparentNow = header.transparentOnTop && !scrolled;
  const surfaceClass =
    transparentNow || header.background === 'transparent'
      ? 'border-transparent bg-transparent'
      : header.background === 'glass'
        ? 'border-border bg-bg/70 backdrop-blur-md'
        : 'border-border bg-bg';

  const renderLogo = (className?: string) => (
    <Link
      to="/"
      className={cn('flex items-center gap-2.5 text-fg no-underline', className)}
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
          <span className="text-base font-semibold tracking-tight">{logoText}</span>
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
        <Link to="/admin" className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'hidden sm:inline-flex' })}>
          <Icon name="dashboard" size={15} />
          后台
        </Link>
      ) : null}
      <button
        type="button"
        className={buttonStyles({ variant: 'ghost', size: 'icon-sm', className: 'md:hidden' })}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '关闭菜单' : '打开菜单'}
        aria-expanded={open}
      >
        <Icon name={open ? 'close' : 'menu'} size={20} />
      </button>
    </>
  );

  const mobileMenu: ReactNode = open && (
    <div
      className={cn(
        'border-t border-border md:hidden',
        header.background === 'glass' || header.background === 'transparent' ? 'bg-bg/95 backdrop-blur-md' : 'bg-bg',
      )}
    >
      <nav className="container-page flex flex-col py-2">
        {settings.navigation.map((item) =>
          item.external ? (
            <a
              key={item.id}
              href={item.href}
              target={item.newTab ? '_blank' : undefined}
              rel={item.newTab ? 'noopener noreferrer' : undefined}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
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
          className={cn('fixed inset-y-0 left-0 z-40 hidden flex-col border-r lg:flex', surfaceClass)}
          style={{ width: LEFT_NAV_WIDTH }}
        >
          <div className={cn('flex shrink-0 items-center px-5', justify)} style={barStyle}>
            {renderLogo()}
          </div>
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
            <NavItems vertical vt={vt} />
          </nav>
          <div
            className={cn('flex shrink-0 items-center gap-1 border-t px-3 py-3', mutedEdge ? 'border-transparent' : 'border-border', justify)}
          >
            {actions}
          </div>
        </aside>

        <header className={cn('sticky top-0 z-40 w-full border-b transition-colors lg:hidden', surfaceClass)}>
          <div className="container-page flex items-center gap-4" style={barStyle}>
            {renderLogo()}
            <nav
              className={cn(
                'hidden items-center gap-1 md:flex',
                header.style === 'pill' && 'rounded-full border border-border bg-surface-2/50 p-1',
              )}
            >
              <NavItems vertical={false} vt={vt} />
            </nav>
            <div className="ml-auto flex items-center gap-1">{actions}</div>
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
    'hidden items-center md:flex',
    header.style === 'pill' ? 'gap-1 rounded-full border border-border bg-surface-2/50 p-1' : 'gap-1',
    !centered && header.align === 'left' && 'mr-auto',
    !centered && header.align === 'right' && 'ml-auto',
    centered && 'md:justify-self-center',
  );

  const actionsClass = cn('flex items-center gap-1', centered ? 'ml-auto md:ml-0 md:justify-self-end' : 'ml-auto');

  return (
    <>
      <header className={cn(positionClass, 'z-40 w-full border-b transition-colors', surfaceClass)}>
        <div className={barInnerClass} style={barStyle}>
          {renderLogo(centered ? 'md:justify-self-start' : undefined)}

          <nav className={navClass}>
            <NavItems vertical={false} vt={vt} />
          </nav>

          <div className={actionsClass}>{actions}</div>
        </div>

        {mobileMenu}
      </header>

      {header.position === 'fixed' && <div style={barStyle} aria-hidden="true" />}
    </>
  );
}
