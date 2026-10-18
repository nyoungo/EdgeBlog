import { Suspense, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { buttonStyles } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/icons';
import { Centered, Spinner } from '../../components/ui/Feedback';
import { cn } from '../../lib/utils';
import { useAuth } from '../../providers/AuthProvider';
import { useSettings } from '../../providers/SettingsProvider';

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/admin', label: '概览', icon: 'dashboard', end: true },
  { to: '/admin/posts', label: '文章', icon: 'fileText' },
  { to: '/admin/comments', label: '评论', icon: 'message' },
  { to: '/admin/media', label: '媒体', icon: 'image' },
  { to: '/admin/appearance', label: '外观设置', icon: 'palette' },
  { to: '/admin/ai', label: 'AI 设置', icon: 'sparkles' },
];

export function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const { settings } = useSettings();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <Centered className="min-h-dvh">
        <Spinner />
      </Centered>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }

  const sidebar = (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )
          }
        >
          <Icon name={item.icon} size={18} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-bg">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/50 md:flex">
        <Link to="/admin" className="flex h-16 items-center gap-2.5 border-b border-border px-5 no-underline">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg">
            {(settings.site.logo.text || settings.site.name).slice(0, 1).toUpperCase()}
          </span>
          <span className="text-sm font-semibold text-fg">管理后台</span>
        </Link>
        <div className="flex-1">{sidebar}</div>
        <div className="border-t border-border p-3">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Icon name="externalLink" size={18} />
            查看网站
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm', className: 'md:hidden' })}
            onClick={() => setOpen((v) => !v)}
            aria-label="切换菜单"
          >
            <Icon name={open ? 'close' : 'menu'} size={20} />
          </button>
          <div className="flex-1" />
          <span className="hidden text-sm text-muted sm:inline">{user.display_name || user.username}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            <Icon name="logout" size={16} />
            <span className="hidden sm:inline">退出</span>
          </button>
        </header>

        {open && (
          <div className="border-b border-border bg-surface md:hidden">{sidebar}</div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Suspense
            fallback={
              <Centered className="py-24">
                <Spinner />
              </Centered>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
