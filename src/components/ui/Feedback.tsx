import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { buttonStyles } from './Button';
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
    <div className={cn('flex flex-col items-center justify-center rounded-3xl bg-surface px-6 py-16 text-center shadow-card', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-faint">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Load-failure state. Deliberately distinct from EmptyState: an API error must
 * never look like "there is nothing here", or the visitor (and the owner) will
 * read an outage as an empty site.
 */
export function ErrorState({
  title = '加载失败',
  description = '服务暂时不可用，请稍后重试。',
  onRetry,
  retryLabel = '重新加载',
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-3xl bg-warning/[0.08] px-6 py-16 text-center shadow-card',
        className,
      )}
      role="alert"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <Icon name="alert" size={22} />
      </div>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'mt-5' })}>
          <Icon name="refresh" size={14} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Card({
  children,
  className,
  as: Tag = 'div',
  variant = 'card',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
  /** `section` 与站点设置的卡片同款：更大圆角 + 更明显的投影。 */
  variant?: 'card' | 'section';
}) {
  return (
    <Tag
      className={cn(
        variant === 'section'
          ? 'rounded-3xl bg-surface shadow-lift'
          : 'rounded-2xl bg-surface shadow-card',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
