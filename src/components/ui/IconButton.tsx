import { useId } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { Icon, type IconName } from './icons';
import { Tooltip } from './Tooltip';

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
