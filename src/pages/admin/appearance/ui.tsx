import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Field, Input, controlClass } from '../../../components/ui/Field';
import { Switch } from '../../../components/ui/Switch';
import { Icon, type IconName } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';

/**
 * 分区面板:圆角卡片 + 浅底标题栏 + 分隔线。
 * 标题栏用浅色底和正文拉开层次,一眼能看出每一块设置的边界。
 */
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
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-3xl bg-surface shadow-lift',
        className,
      )}
    >
      <header className="flex items-start gap-3 bg-surface-2/50 px-5 py-4">
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
      <div className="flex-1 space-y-4 px-5 py-5">{children}</div>
    </section>
  );
}

/** 标签在左、控件在右的一行设置(窄屏堆叠)。 */
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
        'flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6',
        className,
      )}
    >
      <div className="min-w-[7rem] sm:max-w-[30rem]">
        <div className="text-sm font-medium text-fg">{label}</div>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

/** 胶囊式分段选择:同一组里单选,选中项用主色实心块。 */
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
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-full bg-surface-2 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            value === option.value
              ? 'bg-brand text-brand-fg shadow-sm'
              : 'text-muted hover:bg-surface hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 输入框右侧的清除按钮。 */
export function InlineClear({ onClick, label = '清除' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Icon name="close" size={14} />
    </button>
  );
}

/** 带清除按钮的文本输入,用于 URL / 颜色等可留空的值。 */
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
          className={cn(controlClass, 'h-10 pr-10')}
        />
        {value !== '' && <InlineClear onClick={() => onChange('')} />}
      </div>
    </Field>
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 颜色选择器:左侧色块,右侧可自由输入,输入框内带清除按钮。 */
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
          className="h-10 w-11 shrink-0 cursor-pointer rounded-lg bg-transparent p-0.5 ring-1 ring-fg/10"
          aria-label={`选择${label}颜色`}
        />
        <div className="relative min-w-0 flex-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            className={cn(controlClass, 'h-10 pr-10')}
          />
          {value && <InlineClear onClick={() => onChange('')} />}
        </div>
      </div>
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

/** 开关做成一块小面板,和表单卡片呼应;可传 className 覆盖为无边框行内样式。 */
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
      className={cn(
        'rounded-xl bg-surface-2/50 p-3.5 transition-colors hover:bg-surface-2',
        className,
      )}
    />
  );
}

/** 数字输入,允许输入过程中的中间态(例如末尾的小数点)。 */
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

/** 列表项里的方形图标按钮(上移 / 下移 / 删除)。 */
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
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors disabled:opacity-30',
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
