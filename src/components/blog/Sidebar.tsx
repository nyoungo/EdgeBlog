import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { PostSummary, SidebarColumn, SidebarModule, SidebarModuleId } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { Icon } from '../ui/icons';
import { api } from '../../lib/api';
import { fetchTags } from '../../lib/resource';
import { formatDateShort } from '../../lib/format';
import { useAsync } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';

/**
 * 读取侧栏卡片开关。旧数据或缓存里没有这个字段时回退到默认（全部开启），
 * 避免升级后侧栏整块消失。
 *
 * 新增的 `columns` 卡片对旧数据是「未知项」：默认配置里它存在，但已保存的
 * 设置数组里没有它。这里把默认值里缺失的卡片补到末尾（沿用默认的启用状态），
 * 这样老站升级后也能看到专栏入口，而不会因为少一项就永远打不开。
 */
export function resolveSidebarModules(modules?: SidebarModule[]): SidebarModule[] {
  const saved = Array.isArray(modules) && modules.length > 0 ? modules : DEFAULT_SETTINGS.layout.sidebarModules;
  const known = new Set(saved.map((module) => module.id));
  const missing = DEFAULT_SETTINGS.layout.sidebarModules.filter((module) => !known.has(module.id));
  if (missing.length === 0) return saved;
  // 用户把卡片全关掉（侧栏整体隐藏）时，新补的卡片也保持关闭，不擅自恢复侧栏。
  const anyEnabled = saved.some((module) => module.enabled);
  return [...saved, ...missing.map((module) => ({ ...module, enabled: module.enabled && anyEnabled }))];
}

/** 侧栏是否有任何卡片处于开启状态；全关时上层不渲染侧栏列。 */
export function hasVisibleSidebarCards(modules?: SidebarModule[]): boolean {
  return resolveSidebarModules(modules).some((module) => module.enabled);
}

function RailSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="eb-kicker">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * 页边索引栏：圆角面板承载索引信息，配合小号标签，
 * 与正文形成“索引 → 内容”的阅读顺序。
 */
export function Sidebar() {
  const { settings } = useSettings();
  const { site, features, layout } = settings;
  const vt = features.viewTransitions;
  // 关于卡片头像：优先卡片专属 Logo，其次站点图片 Logo，最后回退首字母。
  const aboutAvatar = site.aboutLogo || (site.logo.type === 'image' ? site.logo.imageUrl : '');

  const recent = useAsync(() => api.get<PostSummary[]>('/posts?perPage=5&sort=newest').then((r) => r.data), []);
  const tags = useAsync(() => fetchTags(), []);

  const modules = resolveSidebarModules(layout.sidebarModules);
  const enabled = (id: SidebarModuleId) => modules.some((m) => m.id === id && m.enabled);

  // 没有绑定任何专栏时接口返回空数组，卡片自然不渲染。
  const columnsEnabled = enabled('columns');
  const columnCard = useAsync(
    () =>
      columnsEnabled
        ? api.get<SidebarColumn[]>('/columns/sidebar').then((r) => r.data)
        : Promise.resolve([] as SidebarColumn[]),
    [columnsEnabled],
  );
  const sidebarColumns = (columnCard.data ?? []).filter((column) => column.latest.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {enabled('about') && (
        <RailSection label="关于">
          <Link
            to="/about"
            viewTransition={vt}
            className="group flex flex-col items-center gap-4 text-center no-underline"
          >
            {aboutAvatar ? (
              <img
                src={aboutAvatar}
                alt=""
                className="size-20 shrink-0 rounded-full object-cover shadow-card ring-8 ring-surface"
              />
            ) : (
              <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-bold text-brand-fg shadow-card ring-8 ring-surface">
                {(site.logo.text || site.name).slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="font-heading text-lg leading-tight text-fg transition-colors group-hover:text-brand">
              {site.name}
            </span>
          </Link>
          <p className="mt-3 text-center text-sm leading-relaxed text-muted">
            {site.aboutText || site.description || site.tagline}
          </p>
        </RailSection>
      )}

      {enabled('latest') && (
        <RailSection
          label="最新"
          action={
            <Link
              to="/posts"
              viewTransition={vt}
              className="eb-kicker inline-flex items-center gap-1 no-underline hover:text-brand"
            >
              全部
              <Icon name="arrowRight" size={12} />
            </Link>
          }
        >
          <ol>
            {(recent.data ?? []).map((post, i) => (
              <li key={post.id}>
                <Link
                  to={`/posts/${post.slug}`}
                  viewTransition={vt}
                  className="eb-index-row group -mx-2 flex items-start gap-3 rounded-xl px-2 py-2.5 no-underline transition-colors hover:bg-surface-2"
                >
                  <span className="eb-index-num pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm font-medium leading-snug text-fg transition-colors group-hover:text-brand">
                      {post.title}
                    </span>
                    <span className="mt-1 block text-[11px] text-faint">
                      {formatDateShort(post.published_at ?? post.created_at)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {recent.loading && !recent.data && <li className="py-2 text-sm text-faint">载入中…</li>}
            {!recent.loading && (!recent.data || recent.data.length === 0) && (
              <li className="py-2 text-sm text-faint">暂无文章</li>
            )}
          </ol>
        </RailSection>
      )}

      {enabled('columns') && sidebarColumns.length > 0 && (
        <RailSection
          label="专栏"
          action={
            <Link
              to="/columns"
              viewTransition={vt}
              className="eb-kicker inline-flex items-center gap-1 no-underline hover:text-brand"
            >
              全部
              <Icon name="arrowRight" size={12} />
            </Link>
          }
        >
          <div className="space-y-4">
            {sidebarColumns.map((column) => (
              <div key={column.id}>
                <Link
                  to={`/columns/${column.slug}`}
                  viewTransition={vt}
                  className="group inline-flex items-center gap-1 text-sm font-medium text-fg no-underline transition-colors hover:text-brand"
                >
                  {column.name}
                  <Icon name="chevronRight" size={12} className="text-faint" />
                </Link>
                <ol className="mt-1.5">
                  {column.latest.map((post) => (
                    <li key={post.id}>
                      <Link
                        to={`/posts/${post.slug}`}
                        viewTransition={vt}
                        className="line-clamp-2 block rounded-md py-1 text-sm leading-snug text-muted no-underline transition-colors hover:text-brand"
                      >
                        {post.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </RailSection>
      )}

      {enabled('tags') && tags.data && tags.data.length > 0 && (
        <RailSection label="标签">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {tags.data.map((tag) => (
              <Link
                key={tag.id}
                to={`/posts?tag=${encodeURIComponent(tag.slug)}`}
                className="group inline-flex items-baseline gap-1.5 text-sm text-muted no-underline transition-colors hover:text-brand"
              >
                {tag.name}
                <span className="eb-index-num">{tag.post_count}</span>
              </Link>
            ))}
          </div>
        </RailSection>
      )}

      {enabled('subscribe') && features.rss && (
        <RailSection label="订阅">
          <p className="text-sm leading-relaxed text-muted">通过 RSS 订阅，新文章会直接送到你的阅读器。</p>
          <a
            href="/rss.xml"
            className="group mt-3 inline-flex items-center gap-2 text-xs font-medium text-brand no-underline hover:underline"
          >
            <Icon name="rss" size={14} />
            /rss.xml
          </a>
        </RailSection>
      )}
    </div>
  );
}
