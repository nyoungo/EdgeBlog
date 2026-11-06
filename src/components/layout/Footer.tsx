import { Link } from 'react-router-dom';
import { Icon, socialIcon } from '../ui/icons';
import { useSettings } from '../../providers/SettingsProvider';

export function Footer() {
  const { settings } = useSettings();
  const { site, social, features } = settings;

  return (
    <footer className="mt-20 border-t border-border eb-glass-surface">
      <div className="container-page flex flex-col items-center gap-8 py-12 text-center">
        <div className="flex w-full max-w-sm flex-col items-center">
          <div className="flex items-center justify-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg">
              {(site.logo.text || site.name).slice(0, 1).toUpperCase()}
            </span>
            <span className="text-base font-semibold text-fg">{site.name}</span>
          </div>
          {site.tagline && <p className="mt-3 text-sm text-muted">{site.tagline}</p>}
          {social.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-1">
              {social.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  title={link.label}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <Icon name={socialIcon(link.type)} size={18} />
                </a>
              ))}
            </div>
          )}
        </div>

        {site.footerLinks.length > 0 && (
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {site.footerLinks.map((link) => {
              const className = 'text-sm text-muted no-underline transition-colors hover:text-fg';
              // Only in-app paths go through the router. An external URL used to
              // be handed to <Link>, which navigated the SPA to a 404 instead of
              // leaving the site.
              const external = /^(?:https?:|mailto:|tel:)/i.test(link.href);
              return external ? (
                <a
                  key={link.href + link.label}
                  href={link.href}
                  target={/^https?:/i.test(link.href) ? '_blank' : undefined}
                  rel={/^https?:/i.test(link.href) ? 'noopener noreferrer' : undefined}
                  className={className}
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href + link.label}
                  to={link.href}
                  viewTransition={features.viewTransitions}
                  className={className}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      <div className="border-t border-border">
        <div className="container-page py-5 text-center text-xs text-faint">{site.footerText}</div>
      </div>
    </footer>
  );
}
