import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { Switch } from '../../../components/ui/Switch';
import { MediaField } from '../../../components/admin/MediaField';
import { Icon } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';
import { uploadMedia } from '../../../lib/api';
import { captureVideoThumbnail } from '../../../lib/video-thumbnail';
import { useToast } from '../../../providers/ToastProvider';
import { useAppearance } from './context';
import { resolveSidebarModules } from '../../../components/blog/Sidebar';
import {
  ClearableInput,
  ColorField,
  IconButton,
  Row,
  Section,
  SecondsInput,
  Segmented,
  SwitchTile,
  swap,
} from './ui';

const SOURCES = [
  { id: 'video', label: '背景视频' },
  { id: 'image', label: '背景图片' },
  { id: 'color', label: '背景颜色' },
] as const;

type Source = (typeof SOURCES)[number]['id'];

const MODULE_INFO: Record<string, { label: string; description?: string }> = {
  hero: { label: '欢迎区', description: '背景与尺寸见上方「欢迎区域」' },
  latest: { label: '最新文章' },
  featured: { label: '精选', description: '展示标记为精选的文章' },
  tags: { label: '标签云' },
  newsletter: { label: '订阅', description: 'RSS 订阅入口' },
};

const SIDEBAR_MODULE_INFO: Record<string, { label: string; description?: string }> = {
  about: { label: '关于', description: '站点简介与头像' },
  latest: { label: '最新文章' },
  columns: { label: '专栏', description: '在「专栏管理」里勾选「显示在侧栏」的专栏' },
  tags: { label: '标签云' },
  subscribe: { label: '订阅', description: 'RSS 订阅入口' },
};

/** Explains the video → image → colour fallback and marks the active one. */
function FallbackChain({ active }: { active: Source | 'none' }) {
  const current = SOURCES.find((source) => source.id === active)?.label;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-surface-2/60 px-3 py-2 text-xs">
      {SOURCES.map((source, i) => (
        <span key={source.id} className="flex items-center gap-1.5">
          {i > 0 && <Icon name="chevronRight" size={12} className="text-faint" />}
          <span
            className={cn(
              'rounded-md border px-2 py-0.5',
              active === source.id
                ? 'border-brand/40 bg-brand/10 font-medium text-brand'
                : 'border-transparent text-faint',
            )}
          >
            {source.label}
          </span>
        </span>
      ))}
      <span className="ml-auto text-faint">{current ? `当前生效:${current}` : '当前使用主题渐变'}</span>
    </div>
  );
}

export function HomeTab() {
  const { draft, setHero, setLayout, pickMedia } = useAppearance();
  const { layout } = draft;
  const { hero } = layout;
  const { success, error: toastError } = useToast();
  const [posterBusy, setPosterBusy] = useState(false);

  const video = hero.backgroundVideo;
  const image = hero.backgroundImage;
  const color = hero.background;
  const active: Source | 'none' = video ? 'video' : image ? 'image' : color ? 'color' : 'none';
  const heroMode: 'full' | 'fixed' | 'auto' = hero.fullScreen
    ? 'full'
    : hero.height.trim()
      ? 'fixed'
      : 'auto';

  /** Picking a video also adopts the library's generated first frame as poster. */
  const pickVideo = () =>
    pickMedia('video', (item) =>
      setHero({
        backgroundVideo: item.url,
        backgroundMedia: '',
        ...(image || !item.thumbnail_url ? {} : { backgroundImage: item.thumbnail_url }),
      }),
    );

  const pickImage = () =>
    pickMedia('image', (item) => setHero({ backgroundImage: item.url, backgroundMedia: '' }));

  /** Extract a frame from the current video for older uploads without a poster. */
  const generatePoster = async () => {
    if (!video) return;
    setPosterBusy(true);
    try {
      const file = await captureVideoThumbnail(video);
      if (!file) {
        toastError('无法从该视频生成封面(可能是跨域限制或浏览器不支持该编码),请改为手动选择图片');
        return;
      }
      const item = await uploadMedia(file);
      setHero({ backgroundImage: item.url });
      success('封面已生成');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '生成封面失败');
    } finally {
      setPosterBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title="欢迎区域背景"
        description="三项按视频 → 图片 → 颜色依次回退,留空则继续向下回退"
        icon="image"
        className="xl:col-span-2"
      >
        <FallbackChain active={active} />

        <MediaField
          kind="video"
          label="背景视频"
          value={video}
          poster={image}
          preview={false}
          placeholder="https://.../hero.mp4 或 /media/..."
          hint="优先级最高;MP4 / WebM,单个 ≤ 25MB,自动静音播放。"
          onChange={(value) => setHero({ backgroundVideo: value, backgroundMedia: '' })}
          onPick={pickVideo}
        />

        <MediaField
          label={video ? '背景图片 / 视频封面' : '背景图片'}
          value={image}
          placeholder="https://.../hero.jpg 或 /media/..."
          preview={false}
          hint={
            video
              ? '同时作为视频封面:手机端不播放视频,直接显示这张图;桌面端在视频加载前也用它占位。'
              : '没有视频时作为背景图;也支持 /media/... 相对地址。'
          }
          onChange={(value) => setHero({ backgroundImage: value, backgroundMedia: '' })}
          onPick={pickImage}
          extra={
            video ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={posterBusy}
                  onClick={() => void generatePoster()}
                >
                  <Icon name="refresh" size={14} /> 从视频生成封面
                </Button>
                {!image && <span className="text-xs text-faint">暂无封面时,移动端只显示背景颜色</span>}
              </div>
            ) : undefined
          }
        />

        <ClearableInput
          label="背景颜色 / 渐变"
          value={color}
          placeholder="#0f172a 或 linear-gradient(...)"
          hint="没有视频和图片时生效;留空使用主题渐变。"
          onChange={(value) => setHero({ background: value })}
        />
      </Section>

      {video && (
        <Section
          title="视频播放"
          description="循环方式与播放区间"
          icon="play"
          className="xl:col-span-2"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SwitchTile
              checked={hero.backgroundVideoLoop}
              onChange={(backgroundVideoLoop) => setHero({ backgroundVideoLoop })}
              label="循环播放"
              description="关闭后只播放一次,停在结束时间或最后一帧"
              className="sm:col-span-2"
            />
            <SwitchTile
              checked={hero.backgroundVideoFirstFromStart}
              onChange={(backgroundVideoFirstFromStart) => setHero({ backgroundVideoFirstFromStart })}
              label="第一遍从头播放"
              description="关闭后首轮直接从区间开始时间进入,之后每轮都从区间开始"
              className="sm:col-span-2"
            />
            <SecondsInput
              label="区间开始(秒)"
              value={hero.backgroundVideoStart}
              onChange={(backgroundVideoStart) => setHero({ backgroundVideoStart })}
              hint="循环回到这里;0 表示从头开始。"
            />
            <SecondsInput
              label="区间结束(秒)"
              value={hero.backgroundVideoEnd}
              onChange={(backgroundVideoEnd) => setHero({ backgroundVideoEnd })}
              hint="播到这里切回开始时间;0 表示播放到视频末尾。"
            />
          </div>
          {hero.backgroundVideoEnd > 0 && hero.backgroundVideoEnd <= hero.backgroundVideoStart && (
            <p className="text-xs text-warning">结束时间需大于开始时间,否则会按整段视频循环。</p>
          )}
        </Section>
      )}

      <Section title="尺寸与对齐" description="欢迎区的宽高与内容对齐" icon="dashboard">
        <Row label="高度模式" description="全屏占满视口；固定高度默认 480px（移动 320px）；自适应由内容撑开">
          <Segmented
            value={heroMode}
            onChange={(mode) => {
              if (mode === 'full') setHero({ fullScreen: true });
              else if (mode === 'fixed') setHero({ fullScreen: false, height: hero.height.trim() || '480px' });
              else setHero({ fullScreen: false, height: '' });
            }}
            options={[
              { value: 'full', label: '全屏' },
              { value: 'fixed', label: '固定高度' },
              { value: 'auto', label: '自适应' },
            ]}
          />
        </Row>

        {heroMode === 'fixed' && (
          <Input
            label="固定高度"
            value={hero.height}
            onChange={(e) => setHero({ height: e.target.value })}
            placeholder="480px / 60vh"
            hint="移动端默认缩到 320px，仅在默认 480px 时自动生效。"
            wrapperClassName="sm:max-w-[14rem]"
          />
        )}

        {heroMode === 'full' ? (
          <div className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-muted">
            <Icon name="info" size={15} className="shrink-0 text-brand" />
            当前为「全屏」模式，宽度已锁定为通栏。
          </div>
        ) : (
          <Row label="宽度">
            <Segmented
              value={hero.width}
              onChange={(width) => setHero({ width })}
              options={[
                { value: 'contained', label: '标准' },
                { value: 'narrow', label: '窄' },
                { value: 'full', label: '全宽' },
              ]}
            />
          </Row>
        )}

        <Row label="对齐">
          <Segmented
            value={hero.align}
            onChange={(align) => setHero({ align })}
            options={[
              { value: 'left', label: '居左' },
              { value: 'center', label: '居中' },
            ]}
          />
        </Row>
      </Section>

      <Section title="遮罩与文字" description="压暗背景保证可读性,并可单独指定文字颜色" icon="palette">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="亮色主题遮罩"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={hero.overlayLight}
            onChange={(e) =>
              setHero({ overlayLight: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })
            }
            hint="0–1"
          />
          <Input
            label="暗色主题遮罩"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={hero.overlayDark}
            onChange={(e) => setHero({ overlayDark: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
            hint="0–1"
          />
        </div>
        <div className="grid gap-4">
          <ColorField
            label="标题颜色"
            value={hero.textColor}
            placeholder="留空跟随主题"
            onChange={(textColor) => setHero({ textColor })}
          />
          <ColorField
            label="描述颜色"
            value={hero.textMutedColor}
            placeholder="留空跟随主题"
            onChange={(textMutedColor) => setHero({ textMutedColor })}
          />
        </div>
      </Section>

      <Section
        title="首页模块"
        description="顺序即显示顺序,开关控制是否显示"
        icon="dashboard"
        className="xl:col-span-2"
      >
        <ul className="space-y-2">
          {layout.homeModules.map((module, index) => (
            <li
              key={module.id}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2/50 px-3 py-2.5"
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
        <p className="text-xs text-faint">关闭「订阅」后首页不再显示 RSS 模块,侧边栏订阅入口仍受「导航与页脚」中的 RSS 开关控制。</p>
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
        <Row label="模糊" description="卡片毛玻璃效果(极简风格不适用)">
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

      <Section title="侧边栏卡片" description="首页右侧边栏的每张卡片" icon="columns">
        <ul className="space-y-2">
          {resolveSidebarModules(layout.sidebarModules)
            .filter((module) => SIDEBAR_MODULE_INFO[module.id])
            .map((module) => {
            const info = SIDEBAR_MODULE_INFO[module.id]!;
            return (
              <li
                key={module.id}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2/50 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{info.label}</div>
                  {info.description && <p className="text-xs text-muted">{info.description}</p>}
                </div>
                <Switch
                  checked={module.enabled}
                  onChange={(enabled) =>
                    setLayout({
                      sidebarModules: resolveSidebarModules(layout.sidebarModules).map((m) =>
                        m.id === module.id ? { ...m, enabled } : m,
                      ),
                    })
                  }
                />
              </li>
            );
          })}
        </ul>
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