import { Prose } from '../components/blog/Prose';
import { Icon } from '../components/ui/icons';
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
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-fg">
          <Icon name="info" size={26} className="text-brand" />
          {about.title}
        </h1>
        {about.updatedAt && (
          <p className="mt-2 text-sm text-faint">最后更新于 {formatDate(about.updatedAt, settings.site.locale)}</p>
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
      <p className="text-6xl font-bold tracking-tight text-brand">404</p>
      <h1 className="mt-4 text-2xl font-bold text-fg">页面不存在</h1>
      <p className="mt-2 text-sm text-muted">你访问的页面可能已被移动或删除。</p>
      <a href="/" className="mt-6 text-sm font-medium text-brand hover:underline">
        返回首页
      </a>
    </div>
  );
}
