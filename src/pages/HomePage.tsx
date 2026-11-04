import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { HeaderSettings, HeroSettings, PostSummary } from '@shared/types';
import { buttonStyles } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Centered, EmptyState, ErrorState, Skeleton, Spinner } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PostCard, cardGridClass } from '../components/blog/PostCard';
import { HeroBackgroundVideo } from '../components/blog/HeroBackgroundVideo';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api, qs } from '../lib/api';
import { resolveHeroMedia } from '../lib/hero-media';
import { fetchTags } from '../lib/resource';
import { cn } from '../lib/utils';
import { useAsync } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

function SectionHeading({ title, href, linkLabel = '查看全部' }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
      {href && (
        <Link to={href} className="inline-flex items-center gap-1 text-sm text-muted no-underline hover:text-brand">
          {linkLabel}
          <Icon name="arrowRight" size={15} />
        </Link>
      )}
    </div>
  );
}

/**
 * Homepage welcome ("hero") section. When `full` is set it renders full-bleed
 * outside the sidebar container (see HomePage), otherwise it sits in the column.
 */
function HomeHero({
  hero,
  header,
  name,
  tagline,
  description,
  full,
}: {
  hero: HeroSettings;
  header: HeaderSettings;
  name: string;
  tagline: string;
  description: string;
  full: boolean;
}) {
  const media = resolveHeroMedia(hero);
  const hasCustomBg = Boolean(media.image || hero.background || media.video);
  const style: CSSProperties & Record<`--${string}`, string> = {};
  if (media.image) {
    style.backgroundImage = `url("${media.image}")`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
    style.backgroundRepeat = 'no-repeat';
  } else if (hero.background) {
    style.background = hero.background;
  }
  if (hero.fullScreen) {
    style.minHeight = '100vh';
    // Pull the hero up behind an in-flow nav bar so it covers the header area;
    // `fixed` / `left` navs already sit outside the flow on desktop.
    if (header.position === 'static' || header.position === 'sticky') {
      style.marginTop = `calc(-1 * ${header.height || '64px'})`;
    }
    // Nudge the centred content upward.
    style.paddingBottom = '20vh';
  } else if (hero.height) {
    style.minHeight = hero.height;
  }
  style['--eb-hero-ol-light'] = String(hero.overlayLight);
  style['--eb-hero-ol-dark'] = String(hero.overlayDark);

  const titleColor = hero.textColor || undefined;
  const descColor = hero.textMutedColor || hero.textColor || undefined;
  const taglineColor = titleColor || descColor || 'rgb(var(--c-fg))';
  const textShadow = '0 1px 3px rgba(0,0,0,0.35), 0 6px 22px rgba(0,0,0,0.3)';

  return (
    <section
      className={cn(
        'relative isolate overflow-hidden border border-border px-6 py-14 sm:px-12 sm:py-20',
        hasCustomBg ? 'bg-bg' : 'bg-gradient-to-br from-surface-2 to-surface',
        full ? 'w-full rounded-none' : 'mb-16 rounded-2xl',
        !full && hero.width === 'narrow' && 'mx-auto w-full max-w-3xl',
        hero.fullScreen && 'flex items-center',
      )}
      style={style}
    >
      {media.video && (
        <HeroBackgroundVideo
          src={media.video}
          poster={media.poster || undefined}
          loop={hero.backgroundVideoLoop}
          start={hero.backgroundVideoStart}
          end={hero.backgroundVideoEnd}
        />
      )}
      {(hero.overlayLight > 0 || hero.overlayDark > 0) && (
        <div className="eb-hero-scrim pointer-events-none absolute inset-0" aria-hidden="true" />
      )}
      <div className={cn('relative z-10', full && 'container-page')}>
        <div className={cn(hero.align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl')}>
          <Badge
            tone="brand"
            className={cn('mb-6 !px-4 !py-2 !text-2xl', hero.align === 'center' && 'mx-auto')}
          >
            <span
              className="inline-flex items-center gap-2"
              style={{ color: taglineColor, textShadow }}
            >
              <Icon name="sparkles" size={20} />
              {tagline || '欢迎'}
            </span>
          </Badge>
          <h1
            className="text-6xl font-bold leading-tight tracking-tight text-fg text-balance sm:text-7xl"
            style={{ color: titleColor, textShadow }}
          >
            {name}
          </h1>
          <p className="mt-4 text-[2rem] text-muted text-pretty" style={{ color: descColor, textShadow }}>
            {description}
          </p>
        </div>
      </div>
    </section>
  );
}

function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
          <Skeleton className="aspect-[16/9] w-full" />
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HomePage() {
  const { settings } = useSettings();
  const { site, layout, features } = settings;
  const perPage = layout.postsPerPage;

  const modules = layout.homeModules.filter((m) => m.enabled);
  // Only request what the enabled modules actually render — the home page used
  // to fire three list requests even with everything but the hero turned off.
  const wantsLatest = modules.some((m) => m.id === 'latest');
  const wantsFeatured = modules.some((m) => m.id === 'featured');
  const wantsTags = modules.some((m) => m.id === 'tags');

  const latest = useAsync(
    () =>
      wantsLatest
        ? api.get<PostSummary[]>(`/posts${qs({ perPage, sort: 'newest' })}`).then((r) => r.data)
        : Promise.resolve([]),
    [perPage, wantsLatest],
  );
  const featured = useAsync(
    () =>
      wantsFeatured
        ? api
            .get<PostSummary[]>(`/posts${qs({ featured: 1, perPage: 3 })}`)
            .then((r) => r.data)
        : Promise.resolve([]),
    [wantsFeatured],
  );
  const tags = useAsync(() => (wantsTags ? fetchTags() : Promise.resolve([])), [wantsTags]);

  const bleed = layout.hero.fullScreen || layout.hero.width === 'full';
  const heroOutside = bleed && modules.some((m) => m.id === 'hero');
  const heroProps = {
    hero: layout.hero,
    header: layout.header,
    name: site.name,
    tagline: site.tagline,
    description: site.description,
    full: heroOutside,
  };

  return (
    <>
      {heroOutside && <HomeHero {...heroProps} />}
      <PageWithSidebar>
        {modules.map((module) => {
          switch (module.id) {
            case 'hero':
              return heroOutside ? null : <HomeHero key="hero" {...heroProps} />;

            case 'latest':
              return (
                <section key="latest" className="mb-16">
                  <SectionHeading title="最新文章" href="/posts" />
                  {latest.error ? (
                    <ErrorState description={latest.error} onRetry={latest.reload} />
                  ) : latest.loading && !latest.data ? (
                    <CardGridSkeleton count={settings.layout.postsPerPage > 6 ? 6 : settings.layout.postsPerPage} />
                  ) : latest.data && latest.data.length > 0 ? (
                    <div className={cardGridClass(layout.cardStyle, layout.cardSize)}>
                      {latest.data.map((post) => (
                        <PostCard key={post.id} post={post} style={layout.cardStyle} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="fileText" title="还没有文章" description="发布第一篇文章后，它会出现在这里。" />
                  )}
                </section>
              );

            case 'featured':
              if (!featured.data || featured.data.length === 0) return null;
              return (
                <section key="featured" className="mb-16">
                  <SectionHeading title="精选" />
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {featured.data.map((post) => (
                      <PostCard key={post.id} post={post} style="magazine" />
                    ))}
                  </div>
                </section>
              );

            case 'tags':
              if (!tags.data || tags.data.length === 0) return null;
              return (
                <section key="tags" className="mb-16">
                  <SectionHeading title="标签" href="/tags" />
                  <div className="flex flex-wrap gap-2">
                    {tags.data.map((tag) => (
                      <Link key={tag.id} to={`/posts?tag=${encodeURIComponent(tag.slug)}`} className="no-underline">
                        <Badge tone="outline" className="px-3 py-1 text-sm transition-colors hover:border-brand hover:text-brand">
                          {tag.name}
                          <span className="text-faint">{tag.post_count}</span>
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </section>
              );

            case 'newsletter':
              if (!features.newsletter) return null;
              return (
                <section key="newsletter" className="mb-16 rounded-2xl border border-border bg-surface p-8 text-center">
                  <Icon name="rss" size={28} className="mx-auto mb-3 text-brand" />
                  <h2 className="text-lg font-semibold text-fg">订阅更新</h2>
                  <p className="mt-1 text-sm text-muted">
                    用任意 RSS 阅读器订阅（如 Feedly、Inoreader），新文章会自动送达，无需邮箱。
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    <a
                      href="/rss.xml"
                      className={buttonStyles({ variant: 'secondary', className: 'no-underline' })}
                    >
                      <Icon name="rss" size={15} />
                      打开 RSS 订阅源
                    </a>
                    <code className="rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-muted">
                      /rss.xml
                    </code>
                  </div>
                </section>
              );

            default:
              return null;
          }
        })}

        {latest.loading && !latest.data && modules.length === 0 && (
          <Centered>
            <Spinner />
          </Centered>
        )}
      </PageWithSidebar>
    </>
  );
}
