import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Field, controlClass } from './Field';
import { Icon } from './icons';
import { cn } from '../../lib/utils';

/** 选项:纯字符串即“值 == 展示文本”;对象可单独指定展示名与补充说明。 */
export interface ComboBoxOption {
  value: string;
  label?: string;
  /** 展示在名称右侧的次要信息(如完整 id),不参与选中。 */
  hint?: string;
}

export interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<string | ComboBoxOption>;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  placeholder?: string;
  wrapperClassName?: string;
  /** 过滤后没有匹配项时的提示文案 */
  emptyText?: string;
  disabled?: boolean;
}

interface NormalizedOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * 可输入 + 可选的下拉组合框。
 *
 * 原生 <datalist> 只有在当前输入值能匹配到候选项时才会弹出列表,
 * 一旦输入框里已经填了模型 ID,候选列表就会被过滤成空,用户无法再切换模型。
 * 这里改为自绘面板:聚焦时展示全部选项,输入时再按关键字过滤,同时仍允许手动输入任意值。
 *
 * 选项支持“值”和“展示名”分离:输入框显示 label,写回表单的始终是 value,
 * 这样下拉里能看到可读名称,底层仍然拿到可直接调用的 id。
 */
export function ComboBox({
  value,
  onChange,
  options,
  label,
  hint,
  error,
  placeholder,
  wrapperClassName,
  emptyText = '没有匹配的选项',
  disabled,
}: ComboBoxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  /** null 表示未输入关键字(展示全部选项),避免已选中的值把候选列表过滤空。 */
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const items = useMemo<NormalizedOption[]>(
    () =>
      options.map((option) =>
        typeof option === 'string'
          ? { value: option, label: option }
          : { value: option.value, label: option.label ?? option.value, hint: option.hint },
      ),
    [options],
  );

  const labelFor = (raw: string) => items.find((item) => item.value === raw)?.label ?? raw;

  /** 输入框显示文本;已选选项显示其 label,手输内容原样保留。 */
  const [draft, setDraft] = useState(() => labelFor(value));

  // 面板收起时把 value 同步成展示名(外部赋值 / 选中后);展开中不打断用户输入。
  useEffect(() => {
    if (open) return;
    setDraft(labelFor(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items, open]);

  const filtered = useMemo(() => {
    const keyword = query?.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(keyword) ||
        item.value.toLowerCase().includes(keyword) ||
        (item.hint?.toLowerCase().includes(keyword) ?? false),
    );
  }, [items, query]);

  // 点击面板外部时收起
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // 键盘上下移动时把选中项滚入可视区
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActiveIndex(-1);
  };

  const openAll = () => {
    if (disabled) return;
    setQuery(null);
    setActiveIndex(-1);
    setOpen(true);
  };

  const choose = (option: NormalizedOption) => {
    setDraft(option.label);
    onChange(option.value);
    close();
  };

  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      <div ref={rootRef} className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={Boolean(error)}
          autoComplete="off"
          disabled={disabled}
          value={draft}
          placeholder={placeholder}
          className={cn(controlClass, 'pr-10', error && 'border-danger focus:border-danger focus:ring-danger/30')}
          onFocus={openAll}
          onClick={openAll}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            setQuery(next);
            setActiveIndex(-1);
            setOpen(true);
            // 允许手动输入任意值(如自定义模型 id)
            onChange(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) {
                openAll();
                return;
              }
              if (filtered.length === 0) return;
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              setActiveIndex((prev) => (prev + delta + filtered.length) % filtered.length);
              return;
            }
            if (event.key === 'Enter') {
              if (open && activeIndex >= 0 && filtered[activeIndex]) {
                event.preventDefault();
                choose(filtered[activeIndex]);
              }
              return;
            }
            if (event.key === 'Escape') {
              if (open) {
                event.preventDefault();
                close();
              }
            }
          }}
          onBlur={() => {
            // 交由 pointerdown 处理外部点击;这里仅在失焦后稍作延迟收起
            window.setTimeout(() => {
              if (!rootRef.current?.contains(document.activeElement)) close();
            }, 0);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onClick={() => (open ? close() : openAll())}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint transition-colors hover:text-fg disabled:cursor-not-allowed"
        >
          <Icon name="chevronDown" size={14} className={cn('transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-faint">{emptyText}</li>
            ) : (
              filtered.map((option, index) => (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  // 用 mouseDown 阻止输入框先失焦,否则面板会在 click 之前被收起
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-fg',
                    index === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2',
                    option.value === value && 'font-medium text-brand',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.hint && (
                    <span className="ml-auto shrink-0 truncate text-xs text-faint">{option.hint}</span>
                  )}
                  {option.value === value && (
                    <Icon name="check" size={13} className={cn('shrink-0', !option.hint && 'ml-auto')} />
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Field>
  );
}
