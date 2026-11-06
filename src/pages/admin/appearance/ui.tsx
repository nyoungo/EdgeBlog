import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Card } from '../../../components/ui/Feedback';
import { Field, Input, controlClass } from '../../../components/ui/Field';
import { Switch } from '../../../components/ui/Switch';
import { Icon, type IconName } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';

/** Card with a title, description and optional header actions. */
export function Section({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col p-5', className)}>
      <div className="mb-4 flex items-start gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Icon name={icon} size={17} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

/** Label + hint on the left, an inline control on the right (stacked on mobile). */
export function Row({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4',
        className,
      )}
    >
      <div className="min-w-[7rem]">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === option.value ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Clear button rendered inside the right edge of an input. */
export function InlineClear({ onClick, label = '清除' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Icon name="close" size={14} />
    </button>
  );
}

/** Text input with a clear (×) button inside, used for URL / colour values. */
export function ClearableInput({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  className?: string;
}) {
  const inputId = useId();
  return (
    <Field label={label} hint={hint} htmlFor={inputId} className={className}>
      <div className="relative min-w-0">
        <input
          id={inputId}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(controlClass, 'h-10 pr-9')}
        />
        {value !== '' && <InlineClear onClick={() => onChange('')} />}
      </div>
    </Field>
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Colour swatch + free-text value, with the clear button inside the input. */
export function ColorField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={HEX.test(value) ? value : '#6366f1'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
          aria-label={`选择${label}颜色`}
        />
        <div className="relative min-w-0 flex-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            className={cn(controlClass, 'h-10 pr-9')}
          />
          {value && <InlineClear onClick={() => onChange('')} />}
        </div>
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Switch rendered as a bordered tile, matching the form cards. */
export function SwitchTile({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <Switch
      checked={checked}
      onChange={onChange}
      label={label}
      description={description}
      className={cn('rounded-lg border border-border p-3', className)}
    />
  );
}

/** Number input that keeps intermediate text (e.g. a trailing dot) while typing. */
export function SecondsInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  const [text, setText] = useState(String(value));
  // Track our own emitted value so parent re-renders don't erase a trailing dot.
  const emitted = useRef(value);

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(String(value));
    }
  }, [value]);

  return (
    <Input
      label={label}
      type="number"
      min={0}
      max={86_400}
      step={0.1}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = raw === '' ? 0 : Number(raw);
        if (Number.isFinite(parsed)) {
          const next = Math.min(86_400, Math.max(0, parsed));
          emitted.current = next;
          onChange(next);
        }
      }}
      onBlur={() => setText(String(value))}
      hint={hint}
    />
  );
}

/** Small square icon button used for row actions (move / delete). */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'default',
  className,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors disabled:opacity-30',
        tone === 'danger' ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-surface-2 hover:text-fg',
        className,
      )}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

export function swap<T>(list: T[], i: number, j: number): T[] {
  const next = [...list];
  const a = next[i];
  const b = next[j];
  if (a === undefined || b === undefined) return list;
  next[i] = b;
  next[j] = a;
  return next;
}