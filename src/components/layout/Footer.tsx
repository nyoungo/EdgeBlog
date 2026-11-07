import { Link } from 'react-router-dom';
import { Icon, socialIcon } from '../ui/icons';
import { useSettings } from '../../providers/SettingsProvider';

/** 页脚 colophon：没有卡片和玻璃，只有分栏、细线与链接。 */
export function Footer() {
  const { settings } = useSettings();
  const { site, social, features } = settings;
  const vt = features.viewTransitions;

  const external = (href: string) => /^(?:https?:|mailto:|tel:)/i.test(href);
  const footerLinkClass = 'text-sm text-muted no-underline transition-colors hover:text-fg';

  return (
    <footer className="mt-24 bg-surface">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.6fr_1fr]">
        <div>
          <Link to="/" viewTransition={vt} className="inline-flex items-center gap-2.5 no-underline">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand text-xs font-bold text-brand-fg">
              {(site.logo.text || site.name).slice(0, 1).toUpperCase()}
            </span>
            <span className="font-heading text-lg text-fg">{site.name}</span>
          </Link>
          {site.tagline && <p className="mt-3 max-w-[40ch] text-sm leading-relaxed text-muted">{site.tagline}</p>}
          {social.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1">
              {social.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  title={link.label}
                  className="eb-icon-btn"
                >
                  <Icon name={socialIcon(link.type)} size={17} />
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <ul className="space-y-2.5">
            {site.footerLinks.map((link) => (
              <li key={link.href + link.label}>
                {external(link.href) ? (
                  <a
                    href={link.href}
                    target={/^https?:/i.test(link.href) ? '_blank' : undefined}
                    rel={/^https?:/i.test(link.href) ? 'noopener noreferrer' : undefined}
                    className={footerLinkClass}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link to={link.href} viewTransition={vt} className={footerLinkClass}>
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
            {features.rss && !site.footerLinks.some((link) => /\/rss\.xml(?:$|[?#])/i.test(link.href)) && (
              <li>
                <a href="/rss.xml" className={footerLinkClass}>
                  RSS
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="bg-surface-2/60">
        <div className="container-page flex flex-col gap-2 py-5 text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>{site.footerText}</span>
          <span>{site.locale}</span>
        </div>
      </div>
    </footer>
  );
}
