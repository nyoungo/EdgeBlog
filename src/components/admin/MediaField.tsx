import { useId, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Field, controlClass } from '../ui/Field';
import { Icon } from '../ui/icons';
import { cn } from '../../lib/utils';

/**
 * One media URL field: text input, "选择图片/视频" button on the same row, and
 * a clear button inside the input. The preview below is optional.
 */
export function MediaField({
  label,
  hint,
  value,
  onChange,
  onPick,
  kind = 'image',
  placeholder,
  preview = true,
  poster = '',
  extra,
  previewClassName,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onPick: () => void;
  kind?: 'image' | 'video';
  placeholder?: string;
  /** Show an image (or video poster) preview below the field. */
  preview?: boolean;
  /** Poster used for the video preview thumbnail. */
  poster?: string;
  extra?: ReactNode;
  previewClassName?: string;
  className?: string;
}) {
  const thumb = kind === 'video' ? poster : value;
  const inputId = useId();

  return (
    <Field label={label} hint={hint} htmlFor={inputId} className={className}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={inputId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(controlClass, 'h-10 pr-9')}
          />
          {value !== '' && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label="清除媒体地址"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <Button type="button" variant="secondary" className="h-10 shrink-0" onClick={onPick}>
          <Icon name={kind === 'video' ? 'play' : 'image'} size={15} />
          选择{kind === 'video' ? '视频' : '图片'}
        </Button>
      </div>
      {extra}
      {preview && thumb && (
        <div className="relative mt-2 w-fit overflow-hidden rounded-md border border-border bg-surface-2">
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className={cn('block object-cover', previewClassName ?? 'h-24 w-40')}
          />
          {kind === 'video' && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white backdrop-blur-[2px]">
              <Icon name="play" size={20} className="eb-media-icon" />
            </span>
          )}
        </div>
      )}
    </Field>
  );
}