import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { HeaderSettings, HeroSettings, PostSummary } from '@shared/types';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { Icon } from '../components/ui/icons';
import { PostCollection } from '../components/blog/PostListItem';
import { HeroBackgroundVideo } from '../components/blog/HeroBackgroundVideo';
import { PageWithSidebar } from '../components/layout/PageWithSidebar';
import { api, qs } from '../lib/api';
import { resolveHeroMedia } from '../lib/hero-media';
import { fetchTags } from '../lib/resource';
import { cn } from '../lib/utils';
import { useAsync, useMediaQuery } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

type HeroStyle = CSSProperties & Record<`--${string}`, string>;

/** 章节标题：左侧编号 + 衬线标题，右侧“全部”索引链接。 */
function SectionHeading({
  index,
  title,
  href,
  linkLabel = '全部',
}: {
  index: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <span className="eb-index-num">{index}</span>
        <h2 className="font-heading text-2xl leading-none tracking-tight text-fg">{title}</h2>
      </div>
      {href && (
        <Link
          to={href}
          className="eb-kicker inline-flex items-center gap-1.5 no-underline transition-colors hover:text-brand"
        >
          {linkLabel}
          <Icon name="arrowRight" size={13} />
        </Link>
      )}
    </div>
  );
}

/**
 * 首页英雄区。
 *
 * 三档高度由既有字段推导，不新增设置：
 *   fullScreen            -> 全屏
 *   height 非空            -> 固定高度（默认 480px，移动 320px）
 *   两者都空               -> 自适应内容高度
 */
function HomeHero({
  hero,
  header,
  name,
  tagline,
  description,
  full,
  showRss,
}: {
  hero: HeroSettings;
  header: HeaderSettings;
  name: string;
  tagline: string;
  description: string;
  full: boolean;
  showRss: boolean;
}) {
  const media = resolveHeroMedia(hero);
  const sectionRef = useRef<HTMLElement>(null);
  // 手机 / 平板不加载视频：直接显示封面图，省流量也避开自动播放限制。
  const compact = useMediaQuery('(max-width: 767px), (hover: none) and (pointer: coarse)');
  const [videoPaused, setVideoPaused] = useState(false);

  const mode: 'full' | 'fixed' | 'auto' = hero.fullScreen
    ? 'full'
    : hero.height.trim()
      ? 'fixed'
      : 'auto';

  const fixedHeight = hero.height.trim() || '480px';
  const onMedia = Boolean(media.image || media.video);

  const style: HeroStyle = {
    '--eb-hero-h': fixedHeight,
    // 默认 480px 在手机上缩到 320px；自定义高度仍按原值生效。
    '--eb-hero-h-sm': fixedHeight === '480px' ? '320px' : fixedHeight,
    '--eb-hero-ol-light': String(hero.overlayLight),
    '--eb-hero-ol-dark': String(hero.overlayDark),
  };

  if (media.image) {
    if (hero.background) style.background = hero.background;
    style.backgroundImage = `url("${media.image}")`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
    style.backgroundRepeat = 'no-repeat';
  } else if (hero.background) {
    style.background = hero.background;
  }

  // 全屏时压在顶栏下面；左侧导航在桌面端脱离文档流，不参与上提。
  const pullClass =
    mode === 'full'
      ? header.position === 'left'
        ? 'eb-hero-pull-left'
        : 'eb-hero-pull'
      : '';

  // 英雄区里视频的播放/暂停。只操作现有 deck，不碰内部循环状态机。
  useEffect(() => {
    if (!media.video || compact) return;
    const root = sectionRef.current;
    if (!root) return;
    const decks = Array.from(root.querySelectorAll<HTMLVideoElement>('video[data-hero-deck]'));
    if (decks.length === 0) return;

    const sync = () => setVideoPaused(decks.every((video) => video.paused));
    decks.forEach((video) => {
      video.addEventListener('play', sync);
      video.addEventListener('pause', sync);
      video.addEventListener('ended', sync);
    });
    const frame = window.requestAnimationFrame(sync);

    return () => {
      window.cancelAnimationFrame(frame);
      decks.forEach((video) => {
        video.removeEventListener('play', sync);
        video.removeEventListener('pause', sync);
        video.removeEventListener('ended', sync);
      });
    };
  }, [media.video, compact]);

  const toggleVideo = () => {
    const root = sectionRef.current;
    if (!root) return;
    const decks = Array.from(root.querySelectorAll<HTMLVideoElement>('video[data-hero-deck]'));
    if (decks.length === 0) return;
    const active =
      root.querySelector<HTMLVideoElement>('video.eb-hero-video.is-active') ?? decks[0];
    if (!active) return;

    if (active.paused) {
      decks.forEach((video) => {
        if (video !== active) video.pause();
      });
      void active.play().catch(() => undefined);
      setVideoPaused(false);
    } else {
      decks.forEach((video) => video.pause());
      setVideoPaused(true);
    }
  };

  const centered = hero.align === 'center';
  const titleStyle = {
    color: hero.textColor || undefined,
    textShadow: onMedia ? 'var(--eb-hero-text-shadow)' : undefined,
  };
  const descStyle = {
    color: hero.textMutedColor || undefined,
    textShadow: onMedia ? 'var(--eb-hero-text-shadow)' : undefined,
  };
  const linkClass = cn(
    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium no-underline transition-colors',
    onMedia
      ? 'bg-white/15 text-white backdrop-blur-md hover:bg-white/25'
      : 'bg-brand text-brand-fg shadow-sm hover:bg-brand-hover',
  );
  const quietLinkClass = cn(
    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium no-underline transition-colors',
    onMedia ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-muted hover:bg-surface-2 hover:text-fg',
  );

  return (
    <section
      ref={sectionRef}
      data-hero=""
      className={cn(
        'relative isolate flex flex-col overflow-hidden',
        full ? 'w-full' : 'w-full rounded-3xl shadow-card',
        !full && hero.width === 'narrow' && 'mx-auto max-w-3xl',
        mode === 'full' && 'eb-hero-full',
        mode === 'fixed' && 'eb-hero-fixed',
        pullClass,
        onMedia && 'eb-on-media',
        media.video ? 'bg-fg' : onMedia ? 'bg-surface' : 'eb-hero-paper bg-surface',
      )}
      style={style}
    >
      {media.video && !compact && (
        <HeroBackgroundVideo
          src={media.video}
          poster={media.poster || undefined}
          loop={hero.backgroundVideoLoop}
          start={hero.backgroundVideoStart}
          end={hero.backgroundVideoEnd}
          firstFromStart={hero.backgroundVideoFirstFromStart}
        />
      )}

      {/* 遮罩完全由后台设置决定：设为 0 时不再叠加任何固定压暗层。 */}
      {(hero.overlayLight > 0 || hero.overlayDark > 0) && (
        <div className="eb-hero-scrim pointer-events-none absolute inset-0" aria-hidden="true" />
      )}

      <div
        className={cn(
          'relative z-10 flex flex-1 flex-col justify-center',
          full ? 'container-page' : 'px-6 sm:px-10',
          mode === 'full'
            ? 'pb-6 pt-[calc(var(--eb-header-h,64px)+clamp(4rem,12vh,7rem))]'
            : 'py-14 sm:py-20',
        )}
      >
        <div className={cn('max-w-3xl', centered && 'mx-auto text-center')}>
          <div className={cn('mb-6 flex items-center gap-3', centered && 'justify-center')}>
            <span className={cn('eb-kicker', onMedia && 'text-white/80')}>
              {tagline || '索引'}
            </span>
          </div>

          <h1
            className={cn(
              'font-heading text-[clamp(2.5rem,6.2vw,4.75rem)] font-semibold leading-[1.02] tracking-tight',
              !hero.textColor && (onMedia ? 'text-white' : 'text-fg'),
            )}
            style={titleStyle}
          >
            {name}
          </h1>

          {description && (
            <p
              className={cn(
                'mt-5 max-w-[52ch] text-base leading-relaxed sm:text-lg',
                !hero.textMutedColor && (onMedia ? 'text-white/85' : 'text-muted'),
                centered && 'mx-auto',
              )}
              style={descStyle}
            >
              {description}
            </p>
          )}

          <div className={cn('mt-8 flex flex-wrap items-center gap-x-6 gap-y-3', centered && 'justify-center')}>
            <Link to="/posts" className={linkClass}>
              浏览全部文章
              <Icon name="arrowRight" size={14} />
            </Link>
            {showRss && (
              <a href="/rss.xml" className={quietLinkClass}>
                <Icon name="rss" size={14} />
                RSS
              </a>
            )}
          </div>
        </div>
      </div>

      {(mode === 'full' || (media.video && !compact)) && (
        <div
          className={cn(
            'relative z-20 mt-auto grid grid-cols-[1fr_auto_1fr] items-end gap-4',
            full ? 'container-page pb-6 pt-8' : 'px-6 pb-5 sm:px-10',
          )}
        >
          {mode === 'full' && (
            <a
              href="#latest"
              aria-label="向下浏览"
              className={cn(
                'eb-scroll-cue col-start-2 inline-flex items-center justify-center justify-self-center p-1.5 no-underline',
                onMedia ? 'text-white/80 hover:text-white' : 'text-muted hover:text-fg',
              )}
            >
              <Icon name="arrowDown" size={18} />
            </a>
          )}

          {media.video && !compact && (
            <button
              type="button"
              onClick={toggleVideo}
              aria-label={videoPaused ? '播放背景视频' : '暂停背景视频'}
              className={cn(
                'col-start-3 inline-flex size-9 items-center justify-center justify-self-end rounded-full backdrop-blur-md transition-colors',
                onMedia
                  ? 'bg-black/45 text-white hover:bg-black/60'
                  : 'bg-surface/80 text-fg shadow-card hover:bg-surface',
              )}
            >
              <Icon name={videoPaused ? 'play' : 'pause'} size={16} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** 行式列表的加载骨架：保持版式节奏，不用卡片。 */
function RowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-4 rounded-2xl bg-surface p-4 shadow-card">
          <Skeleton className="mt-1 h-3 w-5 shrink-0" />
          <div className="w-full space-y-2.5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-24" />
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
  // 只请求已启用模块真正需要的数据。
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
        ? api.get<PostSummary[]>(`/posts${qs({ featured: 1, perPage: 3 })}`).then((r) => r.data)
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
    showRss: features.rss,
  };

  return (
    <>
      {heroOutside && <HomeHero {...heroProps} />}
      <PageWithSidebar>
        {modules.map((module) => {
          switch (module.id) {
            case 'hero':
              return heroOutside ? null : (
                <div key="hero" className="mb-10">
                  <HomeHero {...heroProps} />
                </div>
              );

            case 'latest': {
              const posts = latest.data ?? [];
              return (
                <section key="latest" id="latest" className="mb-16">
                  {latest.error ? (
                    <ErrorState description={latest.error} onRetry={latest.reload} />
                  ) : latest.loading && !latest.data ? (
                    <RowSkeleton count={Math.min(perPage, 5)} />
                  ) : posts.length > 0 ? (
                    <PostCollection posts={posts} lead />
                  ) : (
                    <EmptyState icon="fileText" title="还没有文章" description="发布第一篇文章后，它会出现在这里。" />
                  )}
                </section>
              );
            }

            case 'featured':
              if (!featured.data || featured.data.length === 0) return null;
              return (
                <section key="featured" className="mb-16">
                  <SectionHeading index="02" title="精选" />
                  <PostCollection posts={featured.data} />
                </section>
              );

            case 'tags':
              if (!tags.data || tags.data.length === 0) return null;
              return (
                <section key="tags" className="mb-16">
                  <SectionHeading index="03" title="标签" href="/tags" />
                  <div className="flex flex-wrap gap-2.5">
                    {tags.data.map((tag) => (
                      <Link
                        key={tag.id}
                        to={`/posts?tag=${encodeURIComponent(tag.slug)}`}
                        className="group inline-flex items-baseline gap-2 rounded-full bg-surface px-4 py-2 text-sm no-underline shadow-card transition-shadow hover:shadow-lift"
                      >
                        <span className="font-medium text-fg transition-colors group-hover:text-brand">
                          #{tag.name}
                        </span>
                        <span className="eb-index-num">{tag.post_count}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              );

            case 'newsletter':
              return (
                <section key="newsletter" className="mb-16 rounded-3xl bg-surface p-8 shadow-card">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <span className="eb-kicker">订阅</span>
                      <h2 className="mt-3 font-heading text-2xl tracking-tight text-fg">订阅更新</h2>
                      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
                        用任意 RSS 阅读器订阅（如 Feedly、Inoreader），新文章会自动送达，无需邮箱。
                      </p>
                    </div>
                    <a
                      href="/rss.xml"
                      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-fg no-underline shadow-sm transition-colors hover:bg-brand-hover"
                    >
                      <Icon name="rss" size={16} />
                      <span>订阅 RSS</span>
                      <Icon name="arrowRight" size={14} />
                    </a>
                  </div>
                </section>
              );

            default:
              return null;
          }
        })}
      </PageWithSidebar>
    </>
  );
}
