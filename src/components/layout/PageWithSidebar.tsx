import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { useSettings } from '../../providers/SettingsProvider';
import { Sidebar } from '../blog/Sidebar';

/**
 * Standard public-page container. Renders the page inside the site shell and,
 * when `layout.sidebar` is `left`/`right`, docks a sidebar column beside it.
 * Below the `lg` breakpoint the sidebar always stacks underneath the content.
 */
export function PageWithSidebar({ children, className }: { children: ReactNode; className?: string }) {
  const { settings } = useSettings();
  const position = settings.layout.sidebar;

  if (position === 'none') {
    return <div className={cn('container-page py-10', className)}>{children}</div>;
  }

  return (
    <div className={cn('container-page py-10', className)}>
      <div className={cn('flex flex-col gap-10', 'lg:flex-row lg:items-start', position === 'left' && 'lg:flex-row-reverse')}>
        <div className="min-w-0 flex-1">{children}</div>
        <aside className="w-full shrink-0 lg:w-72">
          <div className="lg:sticky lg:top-24">
            <Sidebar />
          </div>
        </aside>
      </div>
    </div>
  );
}
