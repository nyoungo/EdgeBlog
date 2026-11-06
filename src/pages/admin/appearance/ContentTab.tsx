import { Input, Textarea } from '../../../components/ui/Field';
import { useAppearance } from './context';
import { Section, SwitchTile } from './ui';

export function ContentTab() {
  const { draft, setFeatures, update } = useAppearance();
  const { about } = draft.pages;
  const { features } = draft;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="文章页功能" description="文章详情页的辅助模块，按需开启" icon="fileText">
        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchTile
            checked={features.toc}
            onChange={(toc) => setFeatures({ toc })}
            label="文章目录"
            description="长文旁显示目录"
          />
          <SwitchTile
            checked={features.views}
            onChange={(views) => setFeatures({ views })}
            label="浏览量"
            description="记录并显示文章阅读量"
          />
          <SwitchTile
            checked={features.relatedPosts}
            onChange={(relatedPosts) => setFeatures({ relatedPosts })}
            label="相关文章"
            description="文章底部显示相关内容"
          />
          <SwitchTile
            checked={features.prevNext}
            onChange={(prevNext) => setFeatures({ prevNext })}
            label="上一篇 / 下一篇"
            description="文章底部显示相邻文章"
          />
        </div>
      </Section>

      <Section title="关于页" description="使用 Markdown 撰写，保存后前台即时更新" icon="fileText">
        <Input
          label="页面标题"
          value={about.title}
          onChange={(e) => update('pages', { about: { ...about, title: e.target.value } })}
        />
        <Textarea
          label="内容（Markdown）"
          value={about.contentMd}
          onChange={(e) => update('pages', { about: { ...about, contentMd: e.target.value } })}
          rows={16}
          className="font-mono text-sm"
        />
      </Section>
    </div>
  );
}