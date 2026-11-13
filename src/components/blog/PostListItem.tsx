import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CardSize, PostSummary } from '@shared/types';
import { Icon } from '../ui/icons';
import { PostCard, cardGridClass, surfaceClass } from './PostCard';
import { cn } from '../../lib/utils';
import { formatDateShort, formatNumber } from '../../lib/format';
import { useSettings } from '../../providers/SettingsProvider';

/** 两位编号：01、02…，按当前列表位置而不是文章 ID。 */
function indexLabel(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/** 行卡片尺寸：只改内边距、标题字号与缩略图，不改变结构。 */
const ROW_SIZE: Record<CardSize, { pad: string; gap: string; title: string; thumb: string }> = {
  sm: { pad: 'p-3.5', gap: 'gap-x-3', title: 'text-base sm:text-lg', thumb: 'w-20' },
  md: { pad: 'p-4', gap: 'gap-x-4 sm:gap-x-5', title: 'text-lg sm:text-xl', thumb: 'w-24' },
  lg: { pad: 'p-5', gap: 'gap-x-5', title: 'text-xl sm:text-2xl', thumb: 'w-28' },
};

/** 头条卡片尺寸：跟随同一档设置，保证与行卡片节奏一致。 */
const LEAD_SIZE: Record<CardSize, { pad: string; title: string }> = {
  sm: { pad: 'p-5', title: 'text-2xl sm:text-3xl' },
  md: { pad: 'p-6', title: 'text-3xl sm:text-4xl' },
  lg: { pad: 'p-8', title: 'text-4xl sm:text-5xl' },
};

/** 搜索命中高亮；没有查询串时原样返回。 */
function mark(text: string, query?: string) {
  const q = query?.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  if (at === -1) return text;
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={`${at}-${from}`} className="bg-brand/15 px-0.5 text-inherit">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

function Meta({ post, className }: { post: PostSummary; className?: string }) {
  const { settings } = useSettings();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint', className)}>
      <span>{formatDateShort(post.published_at ?? post.created_at)}</span>
      {settings.features.views && (
        <span className="inline-flex items-center gap-1">
          <Icon name="eye" size={12} />
          {formatNumber(post.views)}
        </span>
      )}
      {post.column && (
        // 整行卡片本身就是链接，这里只能用非交互的标识，避免嵌套 <a>。
        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          <Icon name="columns" size={11} />
          {post.column.name}
        </span>
      )}
      {post.tags.length > 0 && (
        <span className="truncate text-muted">{post.tags.slice(0, 2).map((tag) => tag.name).join(' / ')}</span>
      )}
    </div>
  );
}

/**
 * 首页头条：大号衬线标题 + 摘要 + 封面。整块是一个链接。
 */
export function LeadStory({ post, index = 0 }: { post: PostSummary; index?: number }) {
  const { settings } = useSettings();
  const vt = settings.features.viewTransitions;
  const s = LEAD_SIZE[settings.layout.cardSize];
  const blur = settings.layout.cardBlur;

  return (
    <Link
      to={`/posts/${post.slug}`}
      viewTransition={vt}
      className={cn(
        'group grid gap-6 rounded-2xl no-underline md:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)] md:items-center',
        surfaceClass(blur),
        s.pad,
      )}
    >
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-3">
          <span className="eb-index-num">{indexLabel(index)}</span>
          <span className="eb-kicker">头条</span>
        </div>
        <h2
          className={cn(
            'font-heading leading-[1.15] tracking-tight text-fg transition-colors group-hover:text-brand',
            s.title,
          )}
        >
          {post.title}
        </h2>
        {post.excerpt && (
          <p className="mt-4 line-clamp-3 max-w-[46ch] text-base leading-relaxed text-muted">{post.excerpt}</p>
        )}
        <Meta post={post} className="mt-5" />
      </div>

      {post.cover_url && (
        <div className="overflow-hidden rounded-xl">
          <img
            src={post.cover_url}
            alt={post.title}
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
      )}
    </Link>
  );
}

/**
 * 行式索引条目：编号 + 标题 + 摘要 + 右侧缩略图。
 * 列表页与首页共用，`index` 决定显示的编号，支持跨页连续编号。
 */
export function PostRow({
  post,
  index,
  highlight,
}: {
  post: PostSummary;
  index: number;
  highlight?: string;
}) {
  const { settings } = useSettings();
  const vt = settings.features.viewTransitions;
  const s = ROW_SIZE[settings.layout.cardSize];
  const blur = settings.layout.cardBlur;

  return (
    <Link
      to={`/posts/${post.slug}`}
      viewTransition={vt}
      className={cn(
        'eb-index-row group flex rounded-2xl no-underline',
        surfaceClass(blur),
        s.pad,
        s.gap,
      )}
    >
      <span className="eb-index-num mt-1 w-6 shrink-0 text-right">{indexLabel(index)}</span>

      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            'font-heading leading-snug tracking-tight text-fg transition-colors group-hover:text-brand',
            s.title,
          )}
        >
          {mark(post.title, highlight)}
        </h3>
        {post.excerpt && (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{mark(post.excerpt, highlight)}</p>
        )}
        <Meta post={post} className="mt-2.5" />
      </div>

      {post.cover_url && (
        <div className={cn('hidden shrink-0 overflow-hidden rounded-xl sm:block', s.thumb)}>
          <img
            src={post.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full object-cover"
          />
        </div>
      )}
    </Link>
  );
}

/**
 * 文章集合：把后台「文章卡片」的风格设置落到列表上。
 *
 * 杂志（默认）沿用「头条 + 索引行」的新版式；其余风格复用既有 PostCard
 * 的网格 / 浮层 / 极简 / 紧凑实现，尺寸与模糊设置对两者都生效。
 */
export function PostCollection({
  posts,
  offset = 0,
  lead = false,
  highlight,
}: {
  posts: PostSummary[];
  /** 跨页连续编号的起始位置。 */
  offset?: number;
  /** 杂志风格下是否把第一篇放大成头条。 */
  lead?: boolean;
  /** 搜索命中的高亮词。 */
  highlight?: string;
}) {
  const { settings } = useSettings();
  const { cardStyle, cardSize } = settings.layout;

  if (cardStyle === 'magazine') {
    const rest = lead ? posts.slice(1) : posts;
    return (
      <div className="space-y-4">
        {lead && posts[0] && <LeadStory post={posts[0]} index={offset} />}
        {rest.map((post, i) => (
          <PostRow
            key={post.id}
            post={post}
            index={offset + i + (lead ? 1 : 0)}
            highlight={highlight}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cardGridClass(cardStyle, cardSize)}>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} highlight={highlight} />
      ))}
    </div>
  );
}
