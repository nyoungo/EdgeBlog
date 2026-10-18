import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { MediaItem } from '@shared/types';
import { cn } from '../../lib/utils';
import { Icon, type IconName } from '../ui/icons';
import { Select } from '../ui/Field';
import { Prose } from '../blog/Prose';
import { MediaPicker } from './MediaPicker';
import { useClickOutside } from '../../hooks';
import { useToast } from '../../providers/ToastProvider';
import { uploadMedia } from '../../lib/api';
import {
  COMPRESS_OPTIONS,
  compressImage,
  getCompressLevel,
  setCompressLevel,
  type CompressLevel,
} from '../../lib/image-compress';
import {
  editorStats,
  imageMarkdown,
  indentLines,
  insertBlock,
  insertCodeBlock,
  insertLink,
  insertRule,
  insertTable,
  isWrapped,
  lineContext,
  setHeading,
  smartEnter,
  toggleLinePrefix,
  toggleWrap,
  type EditResult,
} from '../../lib/markdown-edit';

type ViewMode = 'edit' | 'split' | 'preview';

const VIEW_KEY = 'eb:editor-view';
const VIEWS: ViewMode[] = ['edit', 'split', 'preview'];
const VIEW_META: Record<ViewMode, { icon: IconName; label: string }> = {
  edit: { icon: 'pencil', label: '编辑' },
  split: { icon: 'columns', label: '分屏' },
  preview: { icon: 'eye', label: '预览' },
};

function readView(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'split' || saved === 'preview' || saved === 'edit') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'edit';
}

const IMAGE_URL = 'https://';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on Ctrl/Cmd + S. */
  onSave?: () => void;
  placeholder?: string;
  /** Extra toolbar content, e.g. AI helpers. */
  extraToolbar?: ReactNode;
  className?: string;
}

/**
 * Markdown writing surface for the admin: grouped toolbar, keyboard shortcuts,
 * drag / paste / picker image upload, split preview and fullscreen.
 */
export function MarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder = '使用 Markdown 写作…（可直接粘贴或拖拽图片上传）',
  extraToolbar,
  className,
}: MarkdownEditorProps) {
  const { success, error } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<[number, number] | null>(null);

  const [view, setView] = useState<ViewMode>(readView);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  const [imageMenu, setImageMenu] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [compress, setCompress] = useState<CompressLevel>(getCompressLevel);

  const imageMenuRef = useClickOutside<HTMLDivElement>(() => setImageMenu(false), imageMenu);
  const helpRef = useClickOutside<HTMLDivElement>(() => setHelpOpen(false), helpOpen);

  const stats = useMemo(() => editorStats(value), [value]);
  const ctx = useMemo(() => lineContext(value, caret.start), [value, caret.start]);

  const readSel = () => {
    const node = textareaRef.current;
    return { start: node?.selectionStart ?? value.length, end: node?.selectionEnd ?? value.length };
  };

  const focusRange = (start: number, end: number) => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(start, end);
    setCaret({ start, end });
  };

  const apply = useCallback(
    (result: EditResult | null) => {
      if (!result) return;
      if (result.value === value) {
        focusRange(result.start, result.end);
        return;
      }
      pending.current = [result.start, result.end];
      onChange(result.value);
    },
    // `value` is required to detect no-op edits
    [onChange, value],
  );

  useLayoutEffect(() => {
    const range = pending.current;
    if (!range) return;
    pending.current = null;
    focusRange(range[0], range[1]);
  }, [value]);

  const run = useCallback(
    (fn: (text: string, start: number, end: number) => EditResult | null) => {
      const { start, end } = readSel();
      apply(fn(value, start, end));
    },
    [apply, value],
  );

  const setMode = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };

  const cycleView = () => {
    const index = VIEWS.indexOf(view);
    setMode(VIEWS[(index + 1) % VIEWS.length] ?? 'edit');
  };

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith('image/'));
      if (images.length === 0) return;
      const { start, end } = readSel();
      setUploading(true);
      try {
        const parts: string[] = [];
        for (const file of images) {
          const item = await uploadMedia(await compressImage(file, compress));
          parts.push(imageMarkdown(item.url, item.filename));
        }
        apply(insertBlock(value, start, end, parts.join('\n\n'), false));
        success(images.length > 1 ? `已上传 ${images.length} 张图片` : '图片已上传');
      } catch (err) {
        error(err instanceof Error ? err.message : '图片上传失败');
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [apply, compress, error, success, value],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && !e.shiftKey && !e.altKey) {
      if (key === 's') {
        e.preventDefault();
        onSave?.();
        return;
      }
      if (key === 'b') {
        e.preventDefault();
        run((text, start, end) => toggleWrap(text, start, end, '**', '**', '粗体'));
        return;
      }
      if (key === 'i') {
        e.preventDefault();
        run((text, start, end) => toggleWrap(text, start, end, '*', '*', '斜体'));
        return;
      }
      if (key === 'k') {
        e.preventDefault();
        run(insertLink);
        return;
      }
      if (key === 'e') {
        e.preventDefault();
        cycleView();
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      run((text, start, end) => indentLines(text, start, end, e.shiftKey));
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const node = e.currentTarget;
      const result = smartEnter(value, node.selectionStart, node.selectionEnd);
      if (result) {
        e.preventDefault();
        apply(result);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.some((file) => file.type.startsWith('image/'))) {
      e.preventDefault();
      void uploadFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    setDragging(false);
    if (files.length === 0) return;
    e.preventDefault();
    void uploadFiles(files);
  };

  const insertImageFromLibrary = (item: MediaItem) => {
    const { start, end } = readSel();
    apply(insertBlock(value, start, end, imageMarkdown(item.url, item.filename), false));
  };

  const insertImageUrl = () => {
    setImageMenu(false);
    run((text, start, end) => {
      const snippet = `![图片](${IMAGE_URL})`;
      const result = insertBlock(text, start, end, snippet, true);
      const at = result.start + snippet.lastIndexOf(IMAGE_URL);
      return { ...result, start: at, end: at + IMAGE_URL.length };
    });
  };

  const onCompressChange = (level: CompressLevel) => {
    setCompress(level);
    setCompressLevel(level);
  };

  const headingValue = ctx.heading >= 1 && ctx.heading <= 4 ? String(ctx.heading) : '0';

  const tools: { items: ToolbarItem[] }[] = [
    {
      items: [
        { icon: 'bold', title: '粗体 (Ctrl+B)', active: isWrapped(value, caret.start, caret.end, '**'), run: () => run((t, s, e) => toggleWrap(t, s, e, '**', '**', '粗体')) },
        { icon: 'italic', title: '斜体 (Ctrl+I)', active: isWrapped(value, caret.start, caret.end, '*'), run: () => run((t, s, e) => toggleWrap(t, s, e, '*', '*', '斜体')) },
        { icon: 'strikethrough', title: '删除线', active: isWrapped(value, caret.start, caret.end, '~~'), run: () => run((t, s, e) => toggleWrap(t, s, e, '~~', '~~', '删除线')) },
        { icon: 'code', title: '行内代码', active: isWrapped(value, caret.start, caret.end, '`'), run: () => run((t, s, e) => toggleWrap(t, s, e, '`', '`', 'code')) },
      ],
    },
    {
      items: [
        { icon: 'quote', title: '引用', active: ctx.quote, run: () => run((t, s, e) => toggleLinePrefix(t, s, e, 'quote')) },
        { icon: 'codeBlock', title: '代码块', run: () => run((t, s, e) => insertCodeBlock(t, s, e)) },
        { icon: 'minus', title: '分割线', run: () => run(insertRule) },
      ],
    },
    {
      items: [
        { icon: 'list', title: '无序列表', active: ctx.list === 'bullet', run: () => run((t, s, e) => toggleLinePrefix(t, s, e, 'bullet')) },
        { icon: 'listOrdered', title: '有序列表', active: ctx.list === 'ordered', run: () => run((t, s, e) => toggleLinePrefix(t, s, e, 'ordered')) },
        { icon: 'listCheck', title: '任务列表', active: ctx.list === 'task', run: () => run((t, s, e) => toggleLinePrefix(t, s, e, 'task')) },
      ],
    },
    {
      items: [
        { icon: 'link', title: '链接 (Ctrl+K)', run: () => run(insertLink) },
        { icon: 'image', title: '图片', active: imageMenu, run: () => setImageMenu((open) => !open) },
        { icon: 'table', title: '表格', run: () => run((t, s, e) => insertTable(t, s, e)) },
      ],
    },
  ];

  const paneHeight = fullscreen ? 'h-full' : view === 'split' ? 'h-[60vh] md:h-[66vh]' : 'min-h-[60vh]';

  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface',
        fullscreen && 'fixed inset-0 z-[80] rounded-none border-0',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-2/50 px-2 py-1.5">
        <Select
          aria-label="标题级别"
          value={headingValue}
          onChange={(e) => run((t, s, en) => setHeading(t, s, en, Number(e.target.value)))}
          className="h-7 w-[4.5rem] py-0 text-xs"
        >
          <option value="0">正文</option>
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
          <option value="4">H4</option>
        </Select>

        {tools.map((group, index) => (
          <div key={index} className="flex items-center gap-0.5">
            <ToolbarDivider />
            {group.items.map((item) => (
              <ToolbarButton key={item.icon} {...item} />
            ))}
          </div>
        ))}

        {extraToolbar ? (
          <div className="flex items-center gap-0.5">
            <ToolbarDivider />
            {extraToolbar}
          </div>
        ) : null}

        {uploading && (
          <span className="ml-1 inline-flex items-center gap-1 text-xs text-brand">
            <Icon name="loader" size={13} className="animate-spin" /> 上传中…
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center rounded-md border border-border p-0.5">
            {VIEWS.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMode(mode)}
                title={`${VIEW_META[mode].label}（Ctrl+E 切换）`}
                aria-pressed={view === mode}
                className={cn(
                  'rounded px-1.5 py-1 transition-colors',
                  view === mode ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
                )}
              >
                <Icon name={VIEW_META[mode].icon} size={15} />
              </button>
            ))}
          </div>
          <ToolbarButton
            icon={fullscreen ? 'minimize' : 'maximize'}
            title={fullscreen ? '退出全屏 (Esc)' : '全屏写作'}
            active={fullscreen}
            run={() => setFullscreen((open) => !open)}
          />
          <div className="relative" ref={helpRef}>
            <ToolbarButton
              icon="help"
              title="快捷键与语法"
              active={helpOpen}
              run={() => setHelpOpen((open) => !open)}
            />
            {helpOpen && <HelpPanel />}
          </div>
        </div>
      </div>

      {imageMenu && (
        <div className="absolute left-3 top-12 z-30 w-64 rounded-lg border border-border bg-surface p-2 shadow-pop" ref={imageMenuRef}>
          <MenuItem
            icon="upload"
            label="上传本地图片"
            hint="可多选"
            onClick={() => {
              setImageMenu(false);
              fileRef.current?.click();
            }}
          />
          <MenuItem
            icon="image"
            label="从媒体库选择"
            onClick={() => {
              setImageMenu(false);
              setPickerOpen(true);
            }}
          />
          <MenuItem icon="link" label="插入图片链接" onClick={insertImageUrl} />
          <div className="mt-1 flex items-center gap-2 border-t border-border pt-2">
            <span className="text-xs text-faint">上传质量</span>
            <Select
              aria-label="上传压缩质量"
              value={compress}
              onChange={(e) => onCompressChange(e.target.value as CompressLevel)}
              className="h-7 flex-1 py-0 text-xs"
            >
              {COMPRESS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void uploadFiles(files);
        }}
      />

      <div
        className={cn(
          'relative grid min-h-0 flex-1',
          view === 'split' && 'md:grid-cols-2',
          fullscreen && 'overflow-hidden',
        )}
      >
        {view !== 'preview' && (
          <div className={cn('relative', view === 'split' && 'md:border-r md:border-border')}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                setCaret({ start: e.target.selectionStart, end: e.target.selectionEnd });
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onSelect={(e) =>
                setCaret({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })
              }
              spellCheck
              placeholder={placeholder}
              className={cn(
                'w-full resize-none border-0 bg-transparent p-4 font-mono text-sm leading-relaxed focus:outline-none',
                paneHeight,
                fullscreen && 'overflow-y-auto',
              )}
            />
            {dragging && (
              <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-brand bg-brand/5 text-sm font-medium text-brand">
                松开即可上传并插入图片
              </div>
            )}
          </div>
        )}

        {view !== 'edit' && (
          <div className={cn('overflow-y-auto p-6', paneHeight, fullscreen && 'min-h-0')}>
            <Prose markdown={value || '*（暂无内容）*'} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-2/50 px-3 py-1.5 text-xs text-faint">
        <span>{stats.words} 字</span>
        <span>{stats.chars} 字符</span>
        <span>{stats.lines} 行</span>
        <span>约 {stats.minutes} 分钟读完</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Icon name="image" size={13} /> 支持粘贴 / 拖拽上传
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="keyboard" size={13} /> Ctrl+S 保存
        </span>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={insertImageFromLibrary}
      />
    </div>
  );
}

interface ToolbarItem {  icon: IconName;
  title: string;
  run: () => void;
  active?: boolean;
}

function ToolbarDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />;
}

function ToolbarButton({ icon, title, run, active }: ToolbarItem) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={Boolean(active)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        'rounded p-1.5 transition-colors',
        active ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface hover:text-fg',
      )}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-surface-2"
    >
      <Icon name={icon} size={15} className="text-muted" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </button>
  );
}

const HELP_ROWS: { keys: string; label: string }[] = [
  { keys: 'Ctrl / ⌘ + B', label: '粗体' },
  { keys: 'Ctrl / ⌘ + I', label: '斜体' },
  { keys: 'Ctrl / ⌘ + K', label: '插入链接' },
  { keys: 'Ctrl / ⌘ + S', label: '保存文章' },
  { keys: 'Ctrl / ⌘ + E', label: '切换编辑 / 分屏 / 预览' },
  { keys: 'Tab / Shift + Tab', label: '增加 / 减少缩进' },
  { keys: 'Enter', label: '自动延续列表、任务、引用' },
  { keys: 'Esc', label: '退出全屏' },
];

const HELP_SYNTAX = [
  { code: '# 标题', label: '标题（# ~ ######）' },
  { code: '- [ ] 待办', label: '任务列表' },
  { code: '| a | b |', label: '表格' },
  { code: '![图片](url)', label: '图片' },
];

function HelpPanel() {  return (
    <div className="absolute right-0 top-8 z-30 w-72 rounded-lg border border-border bg-surface p-3 shadow-pop">
      <p className="mb-2 text-xs font-semibold text-fg">快捷键</p>
      <ul className="space-y-1">
        {HELP_ROWS.map((row) => (
          <li key={row.keys} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted">{row.label}</span>
            <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg">
              {row.keys}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="mb-2 mt-3 text-xs font-semibold text-fg">常用语法</p>
      <ul className="space-y-1">
        {HELP_SYNTAX.map((row) => (
          <li key={row.code} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted">{row.label}</span>
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg">{row.code}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
