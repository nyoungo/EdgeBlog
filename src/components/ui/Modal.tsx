import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Icon } from './icons';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // 调用方几乎都传内联箭头函数，onClose 每次渲染都会变。若把它写进 effect
  // 依赖，父组件每敲一个字符就会重跑一次「移焦 + 归还焦点」，输入框会掉焦点。
  // 用 ref 取最新值，effect 只在开合时执行。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // Pull focus into the dialog; otherwise Tab keeps walking the page behind it.
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      // Hand focus back to whatever opened the dialog.
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-full w-full max-w-md animate-fade-up flex-col rounded-3xl bg-surface p-5 shadow-pop ring-1 ring-fg/5',
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            {title && (
              <h2 id={titleId} className="text-base font-semibold text-fg">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="关闭"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children && <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>}
        {footer && <div className="mt-6 flex shrink-0 justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
