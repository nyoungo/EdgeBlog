import { useEffect, useId, useRef, useState } from 'react';
import type { ThemeMode } from '@shared/types';
import { Icon, type IconName } from './icons';
import { Tooltip } from './Tooltip';
import { cn } from '../../lib/utils';
import { useSettings } from '../../providers/SettingsProvider';

const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: IconName }> = [
  { mode: 'light', label: '明亮', icon: 'sun' },
  { mode: 'dark', label: '暗黑', icon: 'moon' },
  { mode: 'system', label: '跟随系统', icon: 'monitor' },
];

export function ThemeToggle() {
  const { mode, setMode } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0]!;

  return (
    <div className="relative" ref={ref}>
      <Tooltip id={tooltipId} label="切换主题" visible={!open}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="eb-icon-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="切换主题"
          aria-describedby={tooltipId}
        >
          <Icon name={current.icon} size={18} />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className="eb-glass-panel absolute right-0 z-50 mt-2 w-40 animate-fade-up overflow-hidden rounded-lg p-1 shadow-pop"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option.mode}
              onClick={() => {
                setMode(option.mode);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                mode === option.mode ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon name={option.icon} size={16} />
              <span className="flex-1 text-left">{option.label}</span>
              {mode === option.mode && <Icon name="check" size={14} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
