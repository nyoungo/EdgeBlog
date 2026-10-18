import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand/12 text-brand',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
  outline: 'border border-border text-muted',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  published: 'success',
  draft: 'neutral',
  scheduled: 'warning',
  pending: 'warning',
  approved: 'success',
  rejected: 'neutral',
  spam: 'danger',
};

const STATUS_LABELS: Record<string, string> = {
  published: '已发布',
  draft: '草稿',
  scheduled: '定时',
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  spam: '垃圾',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} className={className}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
