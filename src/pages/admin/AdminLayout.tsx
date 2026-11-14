import { Suspense, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { buttonStyles } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/icons';
import { Centered, Spinner } from '../../components/ui/Feedback';
import { AiAssistant } from '../../components/admin/AiAssistant';
import { cn } from '../../lib/utils';
import { useAuth } from '../../providers/AuthProvider';
import { useSettings } from '../../providers/SettingsProvider';

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/admin', label: '概览', icon: 'dashboard', end: true },
  { to: '/admin/posts', label: '文章', icon: 'fileText' },
  { to: '/admin/columns', label: '专栏', icon: 'columns' },
  { to: '/admin/comments', label: '评论', icon: 'message' },
  { to: '/admin/media', label: '媒体', icon: 'image' },
  { to: '/admin/tags', label: '标签', icon: 'tag' },
  { to: '/admin/appearance', label: '站点设置', icon: 'palette' },
  { to: '/admin/ai', label: 'AI 设置', icon: 'sparkles' },
  { to: '/admin/wechat', label: '公众号设置', icon: 'globe' },
  { to: '/admin/automation', label: '定时发文', icon: 'wand' },
  { to: '/admin/audit', label: '审计日志', icon: 'clock' },
  { to: '/admin/account', label: '账号安全', icon: 'lock' },
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
    <nav className="flex flex-col gap-0.5 p-2.5">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
              isActive
                ? 'bg-brand/10 font-medium text-brand'
                : 'text-muted hover:bg-surface-2 hover:text-fg',
            )
          }
        >
          <Icon name={item.icon} size={17} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-bg">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 self-start flex-col overflow-y-auto bg-surface md:flex">
        <Link to="/admin" className="flex h-16 items-center gap-2.5 px-5 no-underline">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-bold text-brand-fg">
            {(settings.site.logo.text || settings.site.name).slice(0, 1).toUpperCase()}
          </span>
          <span className="font-heading text-sm font-semibold text-fg">管理后台</span>
        </Link>
        <div className="flex-1 py-3">{sidebar}</div>
        <div className="p-3">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Icon name="externalLink" size={17} />
            查看网站
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 bg-surface/80 px-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)] backdrop-blur-md sm:px-6">
          <button
            type="button"
            className={buttonStyles({ variant: 'ghost', size: 'icon-sm', className: 'md:hidden' })}
            onClick={() => setOpen((v) => !v)}
            aria-label="切换菜单"
          >
            <Icon name={open ? 'close' : 'menu'} size={20} />
          </button>
          <div className="flex-1" />
          <span className="hidden text-xs text-muted sm:inline">{user.display_name || user.username}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            <Icon name="logout" size={16} />
            <span className="hidden sm:inline">退出</span>
          </button>
        </header>

        {open && <div className="bg-surface shadow-card md:hidden">{sidebar}</div>}

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

      <AiAssistant />
    </div>
  );
}
