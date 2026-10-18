import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Icon, type IconName } from './icons';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Icon name="loader" size={20} className={cn('animate-spin text-muted', className)} />;
}

export function Centered({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center justify-center py-20', className)}>{children}</div>;
}

export function EmptyState({
  icon = 'sparkles',
  title,
  description,
  action,
  className,
}: {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-faint">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
}) {
  return (
    <Tag className={cn('rounded-xl border border-border bg-surface shadow-card', className)}>
      {children}
    </Tag>
  );
}
