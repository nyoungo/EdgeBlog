import type { SocialLink } from '@shared/types';
import { Button } from '../../../components/ui/Button';
import { Input, Select, Textarea } from '../../../components/ui/Field';
import { Icon } from '../../../components/ui/icons';
import { useAppearance } from './context';
import { IconButton, Section, SwitchTile } from './ui';

const SOCIAL_TYPES: SocialLink['type'][] = [
  'github',
  'x',
  'email',
  'rss',
  'mastodon',
  'bluesky',
  'linkedin',
  'youtube',
  'wechat',
  'link',
];

export function FooterTab() {
  const { draft, setSite, setFeatures, update } = useAppearance();
  const { site, social, features } = draft;

  const updateLink = (index: number, patch: Partial<{ label: string; href: string }>) =>
    setSite({
      footerLinks: site.footerLinks.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    });

  const updateSocial = (index: number, patch: Partial<SocialLink>) =>
    update('social', social.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title="页脚内容"
        description="版权文字与页脚链接"
        icon="fileText"
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSite({ footerLinks: [...site.footerLinks, { label: '新链接', href: '/' }] })}
          >
            <Icon name="plus" size={15} /> 添加链接
          </Button>
        }
      >
        <Textarea
          label="版权文字"
          value={site.footerText}
          onChange={(e) => setSite({ footerText: e.target.value })}
          rows={2}
        />
        <div className="space-y-2">
          {site.footerLinks.map((link, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                value={link.label}
                aria-label="链接名称"
                placeholder="名称"
                wrapperClassName="w-28"
                onChange={(e) => updateLink(i, { label: e.target.value })}
              />
              <Input
                value={link.href}
                aria-label="链接地址"
                placeholder="/path 或 https://…"
                wrapperClassName="min-w-[9rem] flex-1"
                onChange={(e) => updateLink(i, { href: e.target.value })}
              />
              <IconButton
                icon="trash"
                label="删除链接"
                tone="danger"
                onClick={() => setSite({ footerLinks: site.footerLinks.filter((_, idx) => idx !== i) })}
              />
            </div>
          ))}
          {site.footerLinks.length === 0 && <p className="text-xs text-faint">还没有页脚链接。</p>}
        </div>
        <SwitchTile
          checked={features.rss}
          onChange={(rss) => setFeatures({ rss })}
          label="RSS 订阅源"
          description="生成 /rss.xml，并在侧边栏显示订阅入口"
        />
      </Section>

      <Section
        title="社交链接"
        description="显示在页脚，图标按类型自动匹配"
        icon="link"
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              update('social', [
                ...social,
                { id: `soc-${Date.now().toString(36)}`, type: 'link', label: '新链接', url: 'https://' },
              ])
            }
          >
            <Icon name="plus" size={15} /> 添加
          </Button>
        }
      >
        <div className="space-y-2">
          {social.map((item, i) => (
            <div key={item.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={item.type}
                  aria-label="链接类型"
                  wrapperClassName="w-28"
                  onChange={(e) => updateSocial(i, { type: e.target.value as SocialLink['type'] })}
                >
                  {SOCIAL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
                <Input
                  value={item.label}
                  aria-label="显示名称"
                  placeholder="名称"
                  wrapperClassName="w-28"
                  onChange={(e) => updateSocial(i, { label: e.target.value })}
                />
                <Input
                  value={item.url}
                  aria-label="链接地址"
                  placeholder="https:// 或 mailto:"
                  wrapperClassName="min-w-[10rem] flex-1"
                  onChange={(e) => updateSocial(i, { url: e.target.value })}
                />
                <IconButton
                  icon="trash"
                  label="删除社交链接"
                  tone="danger"
                  onClick={() => update('social', social.filter((_, idx) => idx !== i))}
                />
              </div>
            </div>
          ))}
          {social.length === 0 && <p className="text-xs text-faint">还没有社交链接。</p>}
        </div>
      </Section>
    </div>
  );
}