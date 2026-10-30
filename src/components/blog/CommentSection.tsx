import { useRef, useState, type FormEvent } from 'react';
import type { Comment } from '@shared/types';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Field';
import { Icon } from '../ui/icons';
import { Centered, EmptyState, Spinner } from '../ui/Feedback';
import { cn } from '../../lib/utils';
import { relativeTime } from '../../lib/format';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks';
import { useAuth } from '../../providers/AuthProvider';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

/** Comments longer than this are collapsed behind a "read more" toggle. */
const COLLAPSE_THRESHOLD = 420;

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? 'bg-brand';
}

function CommentNode({
  comment,
  depth,
  maxDepth,
  onReply,
}: {
  comment: Comment;
  depth: number;
  maxDepth: number;
  onReply: (c: Comment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = comment.content.length > COLLAPSE_THRESHOLD;

  return (
    <div id={`comment-${comment.id}`} className={cn(depth > 0 && 'mt-4 border-l-2 border-border pl-4')}>
      <div className="flex gap-3">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
            avatarColor(comment.author),
          )}
          aria-hidden="true"
        >
          {comment.author.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-fg">{comment.author}</span>
            <span className="text-xs text-faint">{relativeTime(comment.created_at)}</span>
          </div>
          <p
            className={cn(
              'mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-fg/90',
              isLong && !expanded && 'line-clamp-6',
            )}
          >
            {comment.content}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-brand hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? '收起' : `展开全文(${comment.content.length} 字)`}
            </button>
          )}
          {depth < maxDepth && (
            <button
              type="button"
              onClick={() => onReply(comment)}
              className="mt-1.5 text-xs font-medium text-faint transition-colors hover:text-brand"
            >
              回复
            </button>
          )}
        </div>
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-4">
          {comment.replies.map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              maxDepth={maxDepth}
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentSection({ postSlug }: { postSlug: string }) {
  const { settings } = useSettings();
  const { user } = useAuth();
  const { success, error } = useToast();
  const comments = settings.comments;
  const { data, loading, reload } = useAsync(
    () => api.get<Comment[]>(`/comments/post/${postSlug}`).then((r) => r.data),
    [postSlug],
  );

  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [author, setAuthor] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [content, setContent] = useState('');
  const [gotcha, setGotcha] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  if (!settings.features.comments) return null;

  /** Focus and scroll to the form when replying to an off-screen comment. */
  const startReply = (comment: Comment) => {
    setReplyTo(comment);
    requestAnimationFrame(() => {
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      contentRef.current?.focus();
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data: result } = await api.post<{ id: number; status: string; message: string }>('/comments', {
        postSlug,
        parentId: replyTo?.id ?? null,
        author: author.trim(),
        email: email.trim(),
        website: website.trim(),
        content: content.trim(),
        _gotcha: gotcha,
      });
      success(result.message || '评论已提交');
      setContent('');
      setReplyTo(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '提交失败,请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  // The list endpoint returns nested replies, so `data.length` only counted
  // top-level comments — a thread with 20 replies reported "(1)".
  const countAll = (list: Comment[]): number =>
    list.reduce((sum, item) => sum + 1 + countAll(item.replies ?? []), 0);
  const total = countAll(data ?? []);
  const guestsBlocked = !comments.allowGuests && !user;

  return (
    <section id="comments" className="mt-16 border-t border-border pt-10">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
        <Icon name="message" size={18} />
        评论
        {total > 0 && <span className="text-sm font-normal text-faint">({total})</span>}
      </h2>

      {guestsBlocked ? (
        <p className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          评论仅对已登录用户开放。
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 rounded-xl border border-border bg-surface p-4">
          {replyTo && (
            <div className="mb-3 flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
              <span>正在回复 @{replyTo.author}</span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-faint hover:text-fg"
                aria-label="取消回复"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="昵称"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              required
              maxLength={60}
              placeholder="你的昵称"
            />
            <Input
              label="邮箱"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="选填"
              hint="仅站长可见,不会公开"
            />
            <Input
              label="网站"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="选填"
            />
          </div>
          <Textarea
            ref={contentRef}
            label="评论内容"
            className="mt-3"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={4}
            minLength={comments.minLength}
            maxLength={comments.maxLength}
            placeholder="友善地表达你的想法..."
            hint={`${content.length} / ${comments.maxLength}`}
          />

          {/* Honeypot: hidden from humans, irresistible to bots. Must remain empty. */}
          <div className="absolute -left-[9999px]" aria-hidden="true">
            <label>
              请勿填写
              <input
                type="text"
                name="_gotcha"
                tabIndex={-1}
                autoComplete="off"
                value={gotcha}
                onChange={(e) => setGotcha(e.target.value)}
              />
            </label>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-faint">
              {comments.requireModeration ? '评论会在审核后显示。' : '提交后将立即显示。'}
            </p>
            <Button type="submit" loading={submitting}>
              发表评论
            </Button>
          </div>
        </form>
      )}

      <div className="mt-8">
        {loading && !data ? (
          <Centered>
            <Spinner />
          </Centered>
        ) : total === 0 ? (
          <EmptyState icon="message" title="还没有评论" description="成为第一个留下想法的人。" />
        ) : (
          <div className="space-y-6">
            {data?.map((comment) => (
              <CommentNode
                key={comment.id}
                comment={comment}
                depth={0}
                maxDepth={comments.maxDepth}
                onReply={startReply}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}