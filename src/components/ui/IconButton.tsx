import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { Icon, type IconName } from './icons';

/**
 * Icon-only control with a visual tooltip.
 *
 * The tooltip is decorative (`aria-hidden` on the bubble is avoided so screen
 * readers can still use it as a description) and is linked through
 * `aria-describedby`. The button itself always carries `aria-label`.
 */
function Tooltip({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
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
        )}
      >
        {label}
      </span>
    </span>
  );
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  /** Override the icon size (default 18). */
  size?: number;
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  className,
  size = 18,
}: IconButtonProps) {
  const id = useId();
  return (
    <Tooltip id={id} label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-describedby={id}
        className={cn('eb-icon-btn', disabled && 'pointer-events-none opacity-40', className)}
        data-tooltip-anchor=""
      >
        <Icon name={icon} size={size} />
      </button>
    </Tooltip>
  );
}

interface IconLinkProps {
  icon: IconName;
  label: string;
  to?: string;
  href?: string;
  external?: boolean;
  className?: string;
  size?: number;
  onClick?: () => void;
}

export function IconLink({
  icon,
  label,
  to,
  href,
  external,
  className,
  size = 18,
  onClick,
}: IconLinkProps) {
  const id = useId();
  const classes = cn('eb-icon-btn', className);
  const content = <Icon name={icon} size={size} />;

  return (
    <Tooltip id={id} label={label}>
      {href ? (
        <a
          href={href}
          onClick={onClick}
          aria-label={label}
          aria-describedby={id}
          className={classes}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {content}
        </a>
      ) : (
        <Link to={to ?? '/'} onClick={onClick} aria-label={label} aria-describedby={id} className={classes}>
          {content}
        </Link>
      )}
    </Tooltip>
  );
}
