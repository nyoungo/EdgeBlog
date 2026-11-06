import { Input, Select, Textarea } from '../../../components/ui/Field';
import { useAppearance } from './context';
import { Section, SwitchTile } from './ui';

export function AdvancedTab() {
  const { draft, setAdvanced, setFeatures } = useAppearance();
  const { advanced, features } = draft;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="自定义 CSS" description="直接注入页面，可用于微调样式" icon="palette">
        <Textarea
          value={advanced.customCss}
          onChange={(e) => setAdvanced({ customCss: e.target.value })}
          rows={14}
          className="font-mono text-sm"
          placeholder=".prose-article h2 { letter-spacing: -0.01em; }"
        />
      </Section>

      <Section
        title="注入 HTML"
        description="页头 / 页脚注入（统计脚本、验证标签等），请谨慎使用"
        icon="fileText"
      >
        <Textarea
          label="页头 HTML"
          value={advanced.headHtml}
          onChange={(e) => setAdvanced({ headHtml: e.target.value })}
          rows={6}
          className="font-mono text-sm"
        />
        <Textarea
          label="页脚 HTML"
          value={advanced.footerHtml}
          onChange={(e) => setAdvanced({ footerHtml: e.target.value })}
          rows={6}
          className="font-mono text-sm"
        />
      </Section>

      <Section title="访问统计" description="选择统计服务并填入对应标识" icon="globe">
        <Select
          label="统计服务"
          value={advanced.analytics.provider}
          onChange={(e) =>
            setAdvanced({
              analytics: {
                ...advanced.analytics,
                provider: e.target.value as 'none' | 'plausible' | 'umami' | 'ga4',
              },
            })
          }
        >
          <option value="none">不启用</option>
          <option value="plausible">Plausible（域名）</option>
          <option value="umami">Umami（脚本地址）</option>
          <option value="ga4">Google Analytics 4（衡量 ID）</option>
        </Select>
        {advanced.analytics.provider !== 'none' && (
          <Input
            label="标识"
            value={advanced.analytics.token}
            onChange={(e) => setAdvanced({ analytics: { ...advanced.analytics, token: e.target.value } })}
            placeholder={
              advanced.analytics.provider === 'plausible'
                ? 'example.com'
                : advanced.analytics.provider === 'umami'
                  ? 'https://analytics.example.com/script.js'
                  : 'G-XXXXXXXXXX'
            }
          />
        )}
      </Section>

      <Section title="站内交互" description="页面切换与滚动辅助" icon="sparkles">
        <SwitchTile
          checked={features.viewTransitions}
          onChange={(viewTransitions) => setFeatures({ viewTransitions })}
          label="视图过渡动画"
          description="使用 View Transitions API 平滑切换页面"
        />
        <SwitchTile
          checked={features.backToTop}
          onChange={(backToTop) => setFeatures({ backToTop })}
          label="返回顶部"
          description="显示悬浮返回顶部按钮"
        />
      </Section>
    </div>
  );
}