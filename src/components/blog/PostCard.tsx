import { Link } from 'react-router-dom';
import type { CardBlur, CardSize, CardStyle, PostSummary } from '@shared/types';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/icons';
import { cn } from '../../lib/utils';
import { formatDateShort, formatNumber } from '../../lib/format';
import { useSettings } from '../../providers/SettingsProvider';

const SIZE: Record<
  CardSize,
  { pad: string; title: string; excerpt: string; cover: string; thumb: string; meta: string }
> = {
  sm: {
    pad: 'p-3.5',
    title: 'text-sm',
    excerpt: 'line-clamp-2 text-xs',
    cover: 'aspect-[16/10]',
    thumb: 'h-12 w-16',
    meta: 'text-[11px]',
  },
  md: {
    pad: 'p-5',
    title: 'text-lg',
    excerpt: 'line-clamp-3 text-sm',
    cover: 'aspect-[16/9]',
    thumb: 'h-16 w-24',
    meta: 'text-xs',
  },
  lg: {
    pad: 'p-6',
    title: 'text-xl',
    excerpt: 'line-clamp-4 text-base',
    cover: 'aspect-[16/9]',
    thumb: 'h-20 w-28',
    meta: 'text-xs',
  },
};

const BLUR: Record<CardBlur, string> = {
  none: '',
  sm: 'backdrop-blur-sm',
  md: 'backdrop-blur-md',
  lg: 'backdrop-blur-lg',
};

/** Card surface: solid, or frosted-glass when a blur level is set. */
function surfaceClass(blur: CardBlur): string {
  return cn('border border-border shadow-card', blur === 'none' ? 'bg-surface' : 'bg-surface/70', BLUR[blur]);
}

/** Responsive grid class for a list of cards; honours the card style + size. */
export function cardGridClass(style: CardStyle, size: CardSize): string {
  if (style === 'minimal' || style === 'compact') return 'grid gap-3';
  if (style === 'overlay') {
    if (size === 'sm') return 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
    if (size === 'lg') return 'grid gap-6 sm:grid-cols-1 lg:grid-cols-2';
    return 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3';
  }
  if (size === 'sm') return 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
  if (size === 'lg') return 'grid gap-8 sm:grid-cols-1 lg:grid-cols-2';
  return 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3';
}

function Cover({ url, title, className }: { url: string | null; title: string; className?: string }) {
  if (!url) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-gradient-to-br from-surface-2 to-surface text-faint',
          className,
        )}
      >
        <Icon name="fileText" size={28} />
      </div>
    );
  }
  return <img src={url} alt={title} loading="lazy" className={cn('object-cover', className)} />;
}

function Meta({ post, className }: { post: PostSummary; className?: string }) {
  const { settings } = useSettings();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <span className="inline-flex items-center gap-1">
        <Icon name="calendar" size={13} />
        {formatDateShort(post.published_at ?? post.created_at)}
      </span>
      {settings.features.views && (
        <span className="inline-flex items-center gap-1">
          <Icon name="eye" size={13} />
          {formatNumber(post.views)}
        </span>
      )}
    </div>
  );
}

/**
 * A post card. The whole card is a single link so every area (cover, text,
 * padding) opens the article; `group` drives the hover states.
 */
export function PostCard({ post, style }: { post: PostSummary; style?: CardStyle }) {
  const { settings } = useSettings();
  const vt = settings.features.viewTransitions;
  const cardStyle = style ?? settings.layout.cardStyle;
  const s = SIZE[settings.layout.cardSize];
  const blur = settings.layout.cardBlur;

  const href = `/posts/${post.slug}`;
  const tags = post.tags.slice(0, 3);

  if (cardStyle === 'minimal') {
    return (
      <Link
        to={href}
        viewTransition={vt}
        className="group block border-b border-border py-6 no-underline first:pt-0 last:border-0"
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                'font-semibold leading-snug text-fg transition-colors group-hover:text-brand',
                s.title,
              )}
            >
              {post.title}
            </h3>
            <p className={cn('mt-1.5 text-muted', s.excerpt)}>{post.excerpt}</p>
            <div className="mt-2.5">
              <Meta post={post} className="text-faint" />
            </div>
          </div>
          {post.cover_url && (
            <Cover
              url={post.cover_url}
              title={post.title}
              className={cn('hidden shrink-0 rounded-lg sm:block', s.thumb)}
            />
          )}
        </div>
      </Link>
    );
  }

  if (cardStyle === 'compact') {
    return (
      <Link
        to={href}
        viewTransition={vt}
        className={cn(
          'group flex items-center gap-3 rounded-lg no-underline transition-colors hover:bg-surface-2',
          surfaceClass(blur),
          s.pad,
        )}
      >
        <Cover url={post.cover_url} title={post.title} className={cn('shrink-0 rounded-md', s.thumb)} />
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'truncate font-semibold text-fg transition-colors group-hover:text-brand',
              s.title,
            )}
          >
            {post.title}
          </h3>
          <Meta post={post} className={cn('mt-1 text-faint', s.meta)} />
        </div>
      </Link>
    );
  }

  if (cardStyle === 'overlay') {
    return (
      <Link
        to={href}
        viewTransition={vt}
        className={cn('group relative flex h-full flex-col overflow-hidden rounded-xl no-underline', surfaceClass(blur))}
      >
        <Cover
          url={post.cover_url}
          title={post.title}
          className={cn('w-full transition-transform duration-500 group-hover:scale-[1.03]', s.cover)}
        />
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent',
            s.pad,
          )}
        >
          {tags.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
          <h3 className={cn('font-semibold leading-snug text-white', s.title)}>{post.title}</h3>
          <div className="mt-2">
            <Meta post={post} className="text-white/80" />
          </div>
        </div>
      </Link>
    );
  }

  if (cardStyle === 'grid') {
    return (
      <Link
        to={href}
        viewTransition={vt}
        className={cn(
          'group flex h-full flex-col overflow-hidden rounded-xl no-underline transition-transform duration-200 hover:-translate-y-0.5',
          surfaceClass(blur),
        )}
      >
        <Cover url={post.cover_url} title={post.title} className={cn('w-full', s.cover)} />
        <div className={cn('flex flex-1 flex-col gap-2', s.pad)}>
          <h3
            className={cn(
              'font-semibold leading-snug text-fg transition-colors group-hover:text-brand',
              s.title,
            )}
          >
            {post.title}
          </h3>
          <p className={cn('flex-1 text-muted', s.excerpt)}>{post.excerpt}</p>
          <Meta post={post} className="text-faint" />
        </div>
      </Link>
    );
  }

  // magazine (default): large cover, tags, richer meta
  return (
    <Link
      to={href}
      viewTransition={vt}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-xl no-underline transition-transform duration-200 hover:-translate-y-0.5',
        surfaceClass(blur),
      )}
    >
      <Cover
        url={post.cover_url}
        title={post.title}
        className={cn('w-full transition-transform duration-500 group-hover:scale-[1.02]', s.cover)}
      />
      <div className={cn('flex flex-1 flex-col gap-2.5', s.pad)}>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag.id} tone="brand">
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
        <h3 className={cn('font-semibold leading-snug text-fg transition-colors group-hover:text-brand', s.title)}>
          {post.title}
        </h3>
        <p className={cn('flex-1 text-muted', s.excerpt)}>{post.excerpt}</p>
        <div className="pt-1">
          <Meta post={post} className="text-faint" />
        </div>
      </div>
    </Link>
  );
}
