import { useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { cn } from '../../lib/utils';
import { useToast } from '../../providers/ToastProvider';

export function ShareButtons({ title, slug }: { title: string; slug: string }) {
  const { success, error } = useToast();
  const [copied, setCopied] = useState(false);

  const url = typeof window !== 'undefined' ? `${window.location.origin}/posts/${slug}` : `/posts/${slug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      success('链接已复制');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      error('复制失败，请手动复制地址栏链接');
    }
  };

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        /* user dismissed */
      }
    } else {
      void copy();
    }
  };

  const btn =
    'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-surface-2 hover:text-fg';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-faint">分享</span>
      <button type="button" onClick={copy} className={btn} aria-label="复制链接" title="复制链接">
        <Icon name={copied ? 'check' : 'copy'} size={16} />
      </button>
      <a
        href={`https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={btn}
        aria-label="分享到 X"
        title="分享到 X"
      >
        <Icon name="twitter" size={16} />
      </a>
      <button type="button" onClick={share} className={cn(btn, 'sm:hidden')} aria-label="更多分享">
        <Icon name="externalLink" size={16} />
      </button>
      <Button variant="ghost" size="sm" className={cn('hidden sm:inline-flex')} onClick={share}>
        <Icon name="externalLink" size={15} />
        分享
      </Button>
    </div>
  );
}
