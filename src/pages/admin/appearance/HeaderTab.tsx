import type { NavItem } from '@shared/types';
import { Input } from '../../../components/ui/Field';
import { Button } from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/icons';
import { useAppearance } from './context';
import { ColorField, IconButton, Row, Section, Segmented, SwitchTile, swap } from './ui';

export function HeaderTab() {
  const { draft, setHeader, setFeatures, update } = useAppearance();
  const { site, layout, navigation, features } = draft;
  const { header } = layout;

  const updateNav = (index: number, patch: Partial<NavItem>) =>
    update(
      'navigation',
      navigation.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="顶栏布局" description="位置、样式、背景与尺寸" icon="globe">
        <Row label="位置" description="「左侧」在桌面端显示竖向侧边栏，移动端仍用顶部栏">
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
          description="未滚动时透明，滚动后显示背景"
        />
      </Section>

      <Section title="颜色与入口" description="颜色留空跟随主题" icon="palette">
        <div className="grid gap-4">
          <ColorField
            label="Logo 字体颜色"
            value={header.logoColor}
            onChange={(logoColor) => setHeader({ logoColor })}
            placeholder="留空跟随主题"
            hint={site.logo.type === 'image' ? '仅文字 Logo 生效；图片 Logo 使用图片本身的颜色。' : undefined}
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
        description="顺序即显示顺序；可设为外部链接或新窗口打开"
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
            <div key={item.id} className="space-y-2 rounded-lg border border-border p-3">
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
                  placeholder="/path 或 https://…"
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
        {navigation.length === 0 && <p className="text-xs text-faint">还没有导航项，点击右上角「添加」。</p>}
      </Section>
    </div>
  );
}