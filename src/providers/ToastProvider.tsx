import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '../components/ui/icons';
import { cn } from '../lib/utils';

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

// 半透明色块在纯黑/纯白背景上会失去保证,统一用实色面板承载文字,
// 状态只通过边框和图标颜色表达。
const STYLES: Record<ToastKind, string> = {
  info: 'border-border bg-surface text-fg',
  success: 'border-success/60 bg-surface text-fg',
  error: 'border-danger/60 bg-surface text-fg',
};

const ICON_STYLES: Record<ToastKind, string> = {
  info: 'text-muted',
  success: 'text-success',
  error: 'text-danger',
};

const ICONS: Record<ToastKind, 'info' | 'check' | 'alert'> = {
  info: 'info',
  success: 'check',
  error: 'alert',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter.current;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => remove(id), kind === 'error' ? 6000 : 3800);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, 'success'),
      error: (m) => show(m, 'error'),
      info: (m) => show(m, 'info'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-pop',
              'animate-fade-up',
              STYLES[item.kind],
            )}
          >
            <Icon name={ICONS[item.kind]} size={18} className={cn('mt-0.5 shrink-0', ICON_STYLES[item.kind])} />
            <p className="flex-1 text-sm leading-snug">{item.message}</p>
            <button
              type="button"
              onClick={() => remove(item.id)}
              className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-fg"
              aria-label="关闭通知"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
