import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import type { AiChatAction, AiChatContext, AiChatMessage, AiChatResult, AiSettingsView, MediaItem } from '@shared/types';
import { api, uploadMedia } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Icon } from '../ui/icons';
import { Spinner } from '../ui/Feedback';

/** Where the floating button sits, persisted per browser. */
const POS_KEY = 'edgeblog:ai-assistant-pos';
const CHAT_KEY = 'edgeblog:ai-assistant-chat';

const BUTTON_SIZE = 56;
const MARGIN = 8;

interface ChatBubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: AiChatAction[];
  error?: boolean;
}

function clampPosition(x: number, y: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - BUTTON_SIZE - MARGIN)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - BUTTON_SIZE - MARGIN)),
  };
}

function initialPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: MARGIN, y: MARGIN };
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampPosition(parsed.x, parsed.y);
      }
    }
  } catch {
    // Ignore corrupted storage.
  }
  return {
    x: Math.max(MARGIN, window.innerWidth - BUTTON_SIZE - 24),
    y: Math.max(MARGIN, window.innerHeight - BUTTON_SIZE - 24),
  };
}

function loadChat(): ChatBubble[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ChatBubble =>
          typeof item === 'object' &&
          item !== null &&
          (item as ChatBubble).role !== undefined &&
          typeof (item as ChatBubble).content === 'string',
      )
      .slice(-40);
  } catch {
    return [];
  }
}

function contextFromPath(pathname: string): AiChatContext {
  const match = pathname.match(/^\/admin\/posts\/([^/]+)/);
  if (match?.[1] && match[1] !== 'new') {
    return { path: pathname, postSlug: decodeURIComponent(match[1]) };
  }
  return { path: pathname };
}

export function AiAssistant() {
  const location = useLocation();

  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(initialPosition);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  const [bubbles, setBubbles] = useState<ChatBubble[]>(loadChat);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);

  const idRef = useRef(0);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const nextId = () => {
    idRef.current += 1;
    return `bubble-${Date.now().toString(36)}-${idRef.current}`;
  };

  /* --------------------------------------------------------- settings sync */

  const refreshSettings = useCallback(async () => {
    try {
      const { data } = await api.get<AiSettingsView>('/ai/settings');
      setReady(data.ready);
    } catch {
      setReady(false);
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings, location.pathname]);

  useEffect(() => {
    const onChange = () => void refreshSettings();
    window.addEventListener('edgeblog:ai-settings-changed', onChange);
    return () => window.removeEventListener('edgeblog:ai-settings-changed', onChange);
  }, [refreshSettings]);

  /* ------------------------------------------------------------- geometry */

  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setPos((prev) => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // Storage may be unavailable (private mode); position just won't persist.
    }
  }, [pos]);

  const panelStyle = useMemo(() => {
    const width = Math.min(400, Math.max(280, viewport.w - MARGIN * 2));
    const height = Math.min(600, Math.max(320, viewport.h - MARGIN * 2));
    // Prefer above the button (right-aligned), leaving a gap so the floating
    // button stays clickable; fall back below when there is no room above.
    let left = pos.x + BUTTON_SIZE - width;
    let top = pos.y - height - MARGIN;
    if (top < MARGIN) top = pos.y + BUTTON_SIZE + MARGIN;
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, viewport.w - width - MARGIN));
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewport.h - height - MARGIN));
    return { left, top, width, height };
  }, [pos, viewport]);

  /* ------------------------------------------------------------ persistence */

  useEffect(() => {
    try {
      window.sessionStorage.setItem(CHAT_KEY, JSON.stringify(bubbles.slice(-40)));
    } catch {
      // Ignore quota / disabled storage.
    }
  }, [bubbles]);

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [bubbles, open, sending]);

  /* ---------------------------------------------------------------- drag */

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    setPos(clampPosition(drag.originX + dx, drag.originY + dy));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) setOpen((value) => !value);
  };

  /* -------------------------------------------------------------- sending */

  const send = async () => {
    const text = input.trim();
    if (sending || uploading || (!text && attachments.length === 0)) return;

    const parts: string[] = [];
    if (text) parts.push(text);
    for (const item of attachments) {
      const cover = item.thumbnail_url ? `（封面：${item.thumbnail_url}）` : '';
      parts.push(`已上传媒体：${item.url}${cover}`);
    }
    const content = parts.join('\n\n');

    const userBubble: ChatBubble = { id: nextId(), role: 'user', content };
    const history = [...bubbles, userBubble];
    setBubbles(history);
    setInput('');
    setAttachments([]);
    setSending(true);

    try {
      const messages: AiChatMessage[] = history
        .filter((bubble) => !bubble.error)
        .slice(-20)
        .map((bubble) => ({ role: bubble.role, content: bubble.content.slice(0, 8000) }));
      const { data } = await api.post<AiChatResult>('/ai/chat', {
        messages,
        context: contextFromPath(location.pathname),
      });
      setBubbles((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content: data.reply, actions: data.actions },
      ]);
    } catch (err) {
      setBubbles((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: err instanceof Error ? err.message : '请求失败，请稍后重试',
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: MediaItem[] = [];
      for (const file of Array.from(files).slice(0, 4)) {
        uploaded.push(await uploadMedia(file));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setBubbles((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: err instanceof Error ? `上传失败：${err.message}` : '上传失败',
          error: true,
        },
      ]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearChat = () => {
    setBubbles([]);
    setInput('');
    setAttachments([]);
    inputRef.current?.focus();
  };

  if (!ready) return null;

  return (
    <>
      <button
        type="button"
        aria-label={open ? '收起 AI 助手' : '打开 AI 助手'}
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        style={{ left: pos.x, top: pos.y, width: BUTTON_SIZE, height: BUTTON_SIZE }}
        className={cn(
          'fixed z-[60] flex touch-none items-center justify-center rounded-full',
          'bg-brand text-brand-fg shadow-lg shadow-brand/25 transition-transform',
          'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          'cursor-grab active:cursor-grabbing',
        )}
      >
        <Icon name={open ? 'close' : 'sparkles'} size={24} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="AI 助手"
          style={panelStyle}
          className="fixed z-[61] flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Icon name="sparkles" size={15} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">AI 助手</p>
                <p className="truncate text-[11px] text-faint">可以帮你写文章、传媒体、审评论</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={clearChat}
                title="清空对话"
                aria-label="清空对话"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <Icon name="trash" size={15} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="收起"
                aria-label="收起"
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {bubbles.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                  <Icon name="sparkles" size={20} />
                </span>
                <p className="text-sm font-medium text-fg">有什么可以帮你？</p>
                <p className="text-xs leading-relaxed text-muted">
                  例如：「写一篇关于 Cloudflare Workers 的草稿」「把最新评论里的垃圾评论标出来」「给视频设置封面」
                </p>
              </div>
            )}

            {bubbles.map((bubble) => (
              <div
                key={bubble.id}
                className={cn('flex', bubble.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed',
                    bubble.role === 'user'
                      ? 'bg-brand text-brand-fg'
                      : bubble.error
                        ? 'bg-danger/10 text-danger'
                        : 'bg-surface-2 text-fg',
                  )}
                >
                  {bubble.content}
                  {bubble.actions && bubble.actions.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-fg/10 pt-2 text-xs">
                      {bubble.actions.map((action, index) => (
                        <li key={`${bubble.id}-${index}`} className="flex items-start gap-1.5">
                          <Icon
                            name={action.ok ? 'check' : 'alert'}
                            size={13}
                            className={cn('mt-0.5 shrink-0', action.ok ? 'text-emerald-500' : 'text-danger')}
                          />
                          <span className={cn('text-muted', !action.ok && 'text-danger')}>{action.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
                  <Spinner className="size-4" />
                  正在思考…
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border p-2.5">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((item) => (
                  <span
                    key={item.id}
                    className="flex max-w-full items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-muted"
                  >
                    <Icon name={item.mime.startsWith('video/') ? 'play' : 'image'} size={12} />
                    <span className="max-w-[160px] truncate">{item.filename || item.url}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((entry) => entry.id !== item.id))}
                      aria-label="移除附件"
                      className="text-faint hover:text-danger"
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-end gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => void onPickFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || sending}
                title="上传图片或视频"
                aria-label="上传图片或视频"
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                {uploading ? <Spinner className="size-4" /> : <Icon name="upload" size={17} />}
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                className="max-h-32 min-h-9 flex-1 resize-none rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || uploading || (!input.trim() && attachments.length === 0)}
                title="发送"
                aria-label="发送"
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Icon name="arrowUp" size={17} />
              </button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-faint">
              AI 可能出错，执行删除或发布前请确认结果。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
