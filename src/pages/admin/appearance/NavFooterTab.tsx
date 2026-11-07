import type { NavItem, SocialLink } from '@shared/types';
import { Input, Select, Textarea } from '../../../components/ui/Field';
import { Button } from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/icons';
import { useAppearance } from './context';
import { ColorField, IconButton, Row, Section, Segmented, SwitchTile, swap } from './ui';

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

export function NavFooterTab() {
  const { draft, setHeader, setSite, setFeatures, update } = useAppearance();
  const { site, layout, navigation, features, social } = draft;
  const { header } = layout;

  const updateNav = (index: number, patch: Partial<NavItem>) =>
    update(
      'navigation',
      navigation.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );

  const updateLink = (index: number, patch: Partial<{ label: string; href: string }>) =>
    setSite({
      footerLinks: site.footerLinks.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    });

  const updateSocial = (index: number, patch: Partial<SocialLink>) =>
    update('social', social.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="顶栏布局" description="位置、样式、背景与尺寸" icon="globe">
        <Row label="位置" description="「左侧」在桌面端显示竖向侧边栏,移动端仍用顶部栏">
          <Segmented
            value={header.position}
            onChange={(position) => setHeader({ position })}
            options={[
              { value: 'static', label: '跟随页面' },
              { value: 'sticky', label: '吸顶' },
              { value: 'fixed', label: '固定' },
              { value: 'left', label: '左侧' },
            ]}
          />
        </Row>
        <Row label="样式">
          <Segmented
            value={header.style}
            onChange={(style) => setHeader({ style })}
            options={[
              { value: 'default', label: '默认' },
              { value: 'minimal', label: '极简' },
              { value: 'pill', label: '胶囊' },
            ]}
          />
        </Row>
        <Row label="背景">
          <Segmented
            value={header.background}
            onChange={(background) => setHeader({ background })}
            options={[
              { value: 'solid', label: '纯色' },
              { value: 'glass', label: '玻璃' },
              { value: 'transparent', label: '透明' },
            ]}
          />
        </Row>
        <Row label="对齐">
          <Segmented
            value={header.align}
            onChange={(align) => setHeader({ align })}
            options={[
              { value: 'left', label: '居左' },
              { value: 'center', label: '居中' },
              { value: 'right', label: '居右' },
            ]}
          />
        </Row>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="高度"
            value={header.height}
            onChange={(e) => setHeader({ height: e.target.value })}
            placeholder="64px"
          />
        </div>
        <SwitchTile
          checked={header.transparentOnTop}
          onChange={(transparentOnTop) => setHeader({ transparentOnTop })}
          label="顶部透明"
          description="未滚动时透明,滚动后显示背景"
        />
      </Section>

      <Section title="颜色与入口" description="颜色留空跟随主题" icon="palette">
        <div className="grid gap-4">
          <ColorField
            label="Logo 字体颜色"
            value={header.logoColor}
            onChange={(logoColor) => setHeader({ logoColor })}
            placeholder="留空跟随主题"
            hint={site.logo.type === 'image' ? '仅文字 Logo 生效;图片 Logo 使用图片本身的颜色。' : undefined}
          />
          <ColorField
            label="导航字体颜色"
            value={header.navColor}
            onChange={(navColor) => setHeader({ navColor })}
            placeholder="留空跟随主题"
            hint="作用于顶部导航与移动端菜单的所有菜单项。"
          />
          <ColorField
            label="右上角图标颜色"
            value={header.actionColor}
            onChange={(actionColor) => setHeader({ actionColor })}
            placeholder="留空跟随主题"
            hint="作用于搜索、主题切换、后台入口与菜单按钮的图标。"
          />
        </div>
        <SwitchTile
          checked={features.search}
          onChange={(search) => setFeatures({ search })}
          label="站内搜索入口"
          description="在顶栏显示搜索按钮与搜索页"
          className="mt-1"
        />
      </Section>

      <Section
        title="导航菜单"
        description="顺序即显示顺序;可设为外部链接或新窗口打开"
        icon="list"
        className="xl:col-span-2"
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              update('navigation', [
                ...navigation,
                {
                  id: `nav-${Date.now().toString(36)}`,
                  label: '新页面',
                  href: '/',
                  external: false,
                  newTab: false,
                },
              ])
            }
          >
            <Icon name="plus" size={15} /> 添加
          </Button>
        }
      >
        <div className="space-y-2">
          {navigation.map((item, i) => (
            <div key={item.id} className="space-y-2 rounded-xl bg-surface-2/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={item.label}
                  placeholder="名称"
                  aria-label="导航名称"
                  wrapperClassName="w-32"
                  onChange={(e) => updateNav(i, { label: e.target.value })}
                />
                <Input
                  value={item.href}
                  placeholder="/path 或 https://..."
                  aria-label="导航地址"
                  wrapperClassName="min-w-[10rem] flex-1"
                  onChange={(e) => updateNav(i, { href: e.target.value })}
                />
                <div className="flex items-center gap-1">
                  <IconButton
                    icon="chevronDown"
                    label="上移"
                    disabled={i === 0}
                    className="rotate-180"
                    onClick={() => update('navigation', swap(navigation, i - 1, i))}
                  />
                  <IconButton
                    icon="chevronDown"
                    label="下移"
                    disabled={i === navigation.length - 1}
                    onClick={() => update('navigation', swap(navigation, i, i + 1))}
                  />
                  <IconButton
                    icon="trash"
                    label="删除"
                    tone="danger"
                    onClick={() => update('navigation', navigation.filter((_, idx) => idx !== i))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 pl-1">
                <SwitchTile
                  checked={item.external}
                  onChange={(external) => updateNav(i, { external })}
                  label="外部链接"
                  className="border-0 p-0"
                />
                <SwitchTile
                  checked={item.newTab}
                  onChange={(newTab) => updateNav(i, { newTab })}
                  label="新窗口打开"
                  className="border-0 p-0"
                />
              </div>
            </div>
          ))}
        </div>
        {navigation.length === 0 && <p className="text-xs text-faint">还没有导航项,点击右上角「添加」。</p>}
      </Section>

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
                placeholder="/path 或 https://..."
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
          description="生成 /rss.xml,并在侧边栏显示订阅入口"
        />
      </Section>

      <Section
        title="社交链接"
        description="显示在页脚,图标按类型自动匹配"
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
            <div key={item.id} className="space-y-2 rounded-xl bg-surface-2/50 p-3">
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