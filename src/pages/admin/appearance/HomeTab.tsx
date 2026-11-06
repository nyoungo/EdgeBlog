import { Input } from '../../../components/ui/Field';
import { Switch } from '../../../components/ui/Switch';
import { Icon } from '../../../components/ui/icons';
import { useAppearance } from './context';
import { IconButton, Row, Section, Segmented, swap } from './ui';

const MODULE_INFO: Record<string, { label: string; description?: string }> = {
  hero: { label: '欢迎区', description: '背景与尺寸在「英雄区」中设置' },
  latest: { label: '最新文章' },
  featured: { label: '精选', description: '展示标记为精选的文章' },
  tags: { label: '标签云' },
  newsletter: { label: '订阅', description: 'RSS 订阅入口' },
};

export function HomeTab() {
  const { draft, setLayout } = useAppearance();
  const { layout } = draft;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title="首页模块"
        description="顺序即显示顺序，开关控制是否显示"
        icon="dashboard"
        className="xl:col-span-2"
      >
        <ul className="space-y-2">
          {layout.homeModules.map((module, index) => (
            <li
              key={module.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5"
            >
              <Icon name="drag" size={15} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg">{MODULE_INFO[module.id]?.label ?? module.id}</div>
                {MODULE_INFO[module.id]?.description && (
                  <p className="text-xs text-muted">{MODULE_INFO[module.id]?.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  icon="chevronDown"
                  label="上移"
                  className="rotate-180"
                  disabled={index === 0}
                  onClick={() => setLayout({ homeModules: swap(layout.homeModules, index - 1, index) })}
                />
                <IconButton
                  icon="chevronDown"
                  label="下移"
                  disabled={index === layout.homeModules.length - 1}
                  onClick={() => setLayout({ homeModules: swap(layout.homeModules, index, index + 1) })}
                />
              </div>
              <Switch
                checked={module.enabled}
                onChange={(enabled) =>
                  setLayout({
                    homeModules: layout.homeModules.map((m) => (m.id === module.id ? { ...m, enabled } : m)),
                  })
                }
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-faint">关闭「订阅」后首页不再显示 RSS 模块，侧边栏订阅入口仍受「页脚与社交」中的 RSS 开关控制。</p>
      </Section>

      <Section title="文章卡片" description="首页与文章列表的卡片形态" icon="list">
        <Row label="卡片风格">
          <Segmented
            value={layout.cardStyle}
            onChange={(cardStyle) => setLayout({ cardStyle })}
            options={[
              { value: 'magazine', label: '杂志' },
              { value: 'minimal', label: '极简' },
              { value: 'grid', label: '网格' },
              { value: 'overlay', label: '浮层' },
              { value: 'compact', label: '紧凑' },
            ]}
          />
        </Row>
        <Row label="尺寸" description="影响内边距、字号与列表密度">
          <Segmented
            value={layout.cardSize}
            onChange={(cardSize) => setLayout({ cardSize })}
            options={[
              { value: 'lg', label: '大' },
              { value: 'md', label: '中' },
              { value: 'sm', label: '小' },
            ]}
          />
        </Row>
        <Row label="模糊" description="卡片毛玻璃效果（极简风格不适用）">
          <Segmented
            value={layout.cardBlur}
            onChange={(cardBlur) => setLayout({ cardBlur })}
            options={[
              { value: 'none', label: '无' },
              { value: 'sm', label: '弱' },
              { value: 'md', label: '中' },
              { value: 'lg', label: '强' },
            ]}
          />
        </Row>
      </Section>

      <Section title="列表布局" description="侧边栏与分页" icon="columns">
        <Row label="侧边栏">
          <Segmented
            value={layout.sidebar}
            onChange={(sidebar) => setLayout({ sidebar })}
            options={[
              { value: 'left', label: '居左' },
              { value: 'right', label: '居右' },
              { value: 'none', label: '无' },
            ]}
          />
        </Row>
        <Input
          label="每页文章数"
          type="number"
          min={1}
          max={50}
          value={layout.postsPerPage}
          onChange={(e) =>
            setLayout({ postsPerPage: Math.min(50, Math.max(1, Math.round(Number(e.target.value)) || 1)) })
          }
          hint="作用于首页最新文章与文章列表分页。"
          wrapperClassName="sm:max-w-[10rem]"
        />
      </Section>
    </div>
  );
}