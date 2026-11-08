import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { useSettings } from '../../providers/SettingsProvider';
import { Sidebar, hasVisibleSidebarCards } from '../blog/Sidebar';

/**
 * Standard public-page container. Renders the page inside the site shell and,
 * when `layout.sidebar` is `left`/`right`, docks the index rail beside it.
 * Below the `lg` breakpoint the rail always stacks underneath the content.
 * 侧栏卡片全部关闭时，这一列也不再渲染，避免正文旁留白。
 */
export function PageWithSidebar({
  children,
  className,
  afterHero = false,
}: {
  children: ReactNode;
  className?: string;
  /** Extra breathing room when the page opens with a full-bleed hero. */
  afterHero?: boolean;
}) {
  const { settings } = useSettings();
  const position = settings.layout.sidebar;
  const showRail = position !== 'none' && hasVisibleSidebarCards(settings.layout.sidebarModules);
  const spacing = afterHero ? 'pb-12 pt-20' : 'py-12';

  if (!showRail) {
    return <div className={cn('container-page', spacing, className)}>{children}</div>;
  }

  return (
    <div className={cn('container-page', spacing, className)}>
      <div
        className={cn(
          'flex flex-col gap-12',
          'lg:flex-row lg:items-start',
          position === 'left' && 'lg:flex-row-reverse',
        )}
      >
        <div className="min-w-0 flex-1">{children}</div>
        <aside className="w-full shrink-0 lg:w-64">
          <div className="rail-sticky">
            <Sidebar />
          </div>
        </aside>
      </div>
    </div>
  );
}
