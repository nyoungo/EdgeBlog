import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Icon-only control with a visual tooltip.
 *
 * The tooltip is decorative (`aria-hidden` on the bubble is avoided so screen
 * readers can still use it as a description) and is linked through
 * `aria-describedby`. The trigger itself always carries `aria-label`.
 */
export function Tooltip({
  id,
  label,
  visible = true,
  children,
}: {
  id: string;
  label: string;
  /** Hide the bubble, e.g. while a dropdown opened from the trigger is showing. */
  visible?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap',
          'rounded-lg bg-surface px-2 py-1 text-xs font-medium text-fg shadow-pop ring-1 ring-fg/5',
          'opacity-0 transition-opacity duration-150',
          'group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          !visible && 'hidden',
        )}
      >
        {label}
      </span>
    </span>
  );
}
