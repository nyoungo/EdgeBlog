import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { cn } from '../../lib/utils';

/**
 * 后台通用分区卡片：与「站点设置」里的卡片完全同一套视觉。
 *
 * 圆角 3xl + 浅底标题栏 + 分隔线。标题栏用浅色底和正文拉开层次，
 * 一眼能看出每一块内容的边界；`actions` 放右侧的「全部 / 新建」之类入口。
 */
export function Section({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  headerClassName,
  as: Tag = 'section',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 内容区额外样式；表格类卡片传 `p-0` 让表格自己贴边。 */
  bodyClassName?: string;
  headerClassName?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return (
    <Tag
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-3xl bg-surface shadow-lift',
        className,
      )}
    >
      <header className={cn('flex items-start gap-3 bg-surface-2/50 px-5 py-4', headerClassName)}>
        {icon && (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Icon name={icon} size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className={cn('flex-1 space-y-4 px-5 py-5', bodyClassName)}>{children}</div>
    </Tag>
  );
}
