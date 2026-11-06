import { Input, Textarea } from '../../../components/ui/Field';
import { MediaField } from '../../../components/admin/MediaField';
import { useAppearance } from './context';
import { Row, Section, Segmented } from './ui';

export function IdentityTab() {
  const { draft, setSite, pickMedia } = useAppearance();
  const { site } = draft;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="站点信息" description="用于浏览器标题、搜索结果与站内文案" icon="home">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="站点名称" value={site.name} onChange={(e) => setSite({ name: e.target.value })} />
          <Input label="标语" value={site.tagline} onChange={(e) => setSite({ tagline: e.target.value })} />
        </div>
        <Textarea
          label="站点描述"
          value={site.description}
          onChange={(e) => setSite({ description: e.target.value })}
          rows={3}
        />
        <Input
          label="语言（locale）"
          value={site.locale}
          onChange={(e) => setSite({ locale: e.target.value })}
          placeholder="zh-CN"
          wrapperClassName="sm:max-w-[12rem]"
        />
      </Section>

      <Section title="站点标识" description="顶栏 Logo 与浏览器标签页图标" icon="image">
        <Row label="Logo 类型">
          <Segmented
            value={site.logo.type}
            onChange={(type) => setSite({ logo: { ...site.logo, type } })}
            options={[
              { value: 'text', label: '文字' },
              { value: 'image', label: '图片' },
            ]}
          />
        </Row>
        {site.logo.type === 'text' ? (
          <Input
            label="Logo 文字"
            value={site.logo.text}
            onChange={(e) => setSite({ logo: { ...site.logo, text: e.target.value } })}
          />
        ) : (
          <MediaField
            label="Logo 图片"
            value={site.logo.imageUrl}
            placeholder="https://… 或 /media/…"
            previewClassName="h-10 w-auto max-w-[12rem] object-contain"
            onChange={(imageUrl) => setSite({ logo: { ...site.logo, imageUrl } })}
            onPick={() => pickMedia('image', (item) => setSite({ logo: { ...site.logo, imageUrl: item.url } }))}
          />
        )}

        <div className="border-t border-border pt-4">
          <MediaField
            label="站点图标（favicon）"
            value={site.favicon}
            placeholder="留空自动生成"
            previewClassName="h-10 w-10 object-contain p-1"
            hint="留空则用品牌主色圆角块 + 站点名首字母自动生成。"
            onChange={(favicon) => setSite({ favicon })}
            onPick={() => pickMedia('image', (item) => setSite({ favicon: item.url }))}
          />
          {!site.favicon && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-brand-fg"
                style={{ background: 'rgb(var(--c-brand))' }}
              >
                {(site.logo.text || site.name || 'E').slice(0, 1).toUpperCase()}
              </span>
              当前使用自动生成的图标
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}