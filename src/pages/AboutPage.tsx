import { Prose } from '../components/blog/Prose';
import { formatDate } from '../lib/format';
import { useDocumentTitle, useMetaDescription } from '../hooks';
import { useSettings } from '../providers/SettingsProvider';

export function AboutPage() {
  const { settings } = useSettings();
  const about = settings.pages.about;
  useDocumentTitle(about.title, settings.site.name);
  useMetaDescription(settings.site.description);

  return (
    <div className="container-page py-12">
      <header className="mx-auto max-w-content">
        <span className="eb-kicker">关于</span>
        <h1 className="mt-3 font-heading text-3xl tracking-tight text-fg sm:text-4xl">{about.title}</h1>
        {about.updatedAt && (
          <p className="mt-2 text-xs text-faint">
            最后更新 {formatDate(about.updatedAt, settings.site.locale)}
          </p>
        )}
      </header>
      <div className="mx-auto mt-10 max-w-content">
        <Prose markdown={about.contentMd} />
      </div>
    </div>
  );
}

export function NotFoundPage() {
  const { settings } = useSettings();
  useDocumentTitle('页面不存在', settings.site.name);
  return (
    <div className="container-page flex flex-col items-center py-32 text-center">
      <span className="eb-index-num text-6xl">404</span>
      <h1 className="mt-4 font-heading text-2xl text-fg">页面不存在</h1>
      <p className="mt-2 text-sm text-muted">你访问的页面可能已被移动或删除。</p>
      <a href="/" className="mt-6 text-sm font-medium text-brand hover:underline">
        返回首页
      </a>
    </div>
  );
}
