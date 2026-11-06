import { Input } from '../../../components/ui/Field';
import { useAppearance } from './context';
import { Section, SwitchTile } from './ui';

export function CommentsTab() {
  const { draft, setComments, setFeatures } = useAppearance();
  const { comments, features } = draft;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="评论系统" description="总开关与审核策略" icon="message">
        <SwitchTile
          checked={features.comments}
          onChange={(value) => setFeatures({ comments: value })}
          label="启用评论"
          description="关闭后文章底部不再显示评论区"
        />
        <SwitchTile
          checked={comments.requireModeration}
          onChange={(requireModeration) => setComments({ requireModeration })}
          label="评论需要审核"
          description="新评论需审核通过后才显示"
        />
        <SwitchTile
          checked={comments.allowGuests}
          onChange={(allowGuests) => setComments({ allowGuests })}
          label="允许访客评论"
          description="关闭后仅登录用户可评论"
        />
      </Section>

      <Section title="频率与长度" description="限制发布频率与评论内容长度" icon="clock">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="最大回复层级"
            type="number"
            min={0}
            max={5}
            value={comments.maxDepth}
            onChange={(e) => setComments({ maxDepth: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })}
            hint="0–5"
          />
          <Input
            label="评论间隔（秒）"
            type="number"
            min={5}
            max={3600}
            value={comments.rateLimitSeconds}
            onChange={(e) =>
              setComments({ rateLimitSeconds: Math.min(3600, Math.max(5, Number(e.target.value) || 5)) })
            }
            hint="5–3600"
          />
          <Input
            label="最短长度"
            type="number"
            min={1}
            max={100}
            value={comments.minLength}
            onChange={(e) => setComments({ minLength: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
            hint="1–100"
          />
          <Input
            label="最长长度"
            type="number"
            min={10}
            max={10000}
            value={comments.maxLength}
            onChange={(e) =>
              setComments({ maxLength: Math.min(10000, Math.max(10, Number(e.target.value) || 10)) })
            }
            hint="10–10000"
          />
        </div>
      </Section>
    </div>
  );
}