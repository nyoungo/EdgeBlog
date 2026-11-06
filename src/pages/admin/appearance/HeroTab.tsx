import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { MediaField } from '../../../components/admin/MediaField';
import { Icon } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';
import { uploadMedia } from '../../../lib/api';
import { captureVideoThumbnail } from '../../../lib/video-thumbnail';
import { useToast } from '../../../providers/ToastProvider';
import { useAppearance } from './context';
import { ClearableInput, ColorField, Row, Section, SecondsInput, Segmented, SwitchTile } from './ui';

const SOURCES = [
  { id: 'video', label: '背景视频' },
  { id: 'image', label: '背景图片' },
  { id: 'color', label: '背景颜色' },
] as const;

type Source = (typeof SOURCES)[number]['id'];

/** Explains the video → image → colour fallback and marks the active one. */
function FallbackChain({ active }: { active: Source | 'none' }) {
  const current = SOURCES.find((source) => source.id === active)?.label;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs">
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
      <span className="ml-auto text-faint">{current ? `当前生效：${current}` : '当前使用主题渐变'}</span>
    </div>
  );
}

export function HeroTab() {
  const { draft, setHero, pickMedia } = useAppearance();
  const { hero } = draft.layout;
  const { success, error: toastError } = useToast();
  const [posterBusy, setPosterBusy] = useState(false);

  const video = hero.backgroundVideo;
  const image = hero.backgroundImage;
  const color = hero.background;
  const active: Source | 'none' = video ? 'video' : image ? 'image' : color ? 'color' : 'none';

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
        toastError('无法从该视频生成封面（可能是跨域限制或浏览器不支持该编码），请改为手动选择图片');
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
        title="背景媒体"
        description="三项按视频 → 图片 → 颜色依次回退，留空则继续向下回退"
        icon="image"
        className="xl:col-span-2"
      >
        <FallbackChain active={active} />

        <MediaField
          kind="video"
          label="背景视频"
          value={video}
          poster={image}
          placeholder="https://…/hero.mp4 或 /media/…"
          hint="优先级最高；MP4 / WebM，单个 ≤ 25MB，自动静音播放。"
          onChange={(value) => setHero({ backgroundVideo: value, backgroundMedia: '' })}
          onPick={pickVideo}
        />

        <MediaField
          label={video ? '背景图片 / 视频封面' : '背景图片'}
          value={image}
          placeholder="https://…/hero.jpg 或 /media/…"
          preview={!video}
          hint={
            video
              ? '同时作为视频封面：手机端不播放视频，直接显示这张图；桌面端在视频加载前也用它占位。'
              : '没有视频时作为背景图；也支持 /media/… 相对地址。'
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
                {!image && <span className="text-xs text-faint">暂无封面时，移动端只显示背景颜色</span>}
              </div>
            ) : undefined
          }
        />

        <ClearableInput
          label="背景颜色 / 渐变"
          value={color}
          placeholder="#0f172a 或 linear-gradient(…)"
          hint="没有视频和图片时生效；留空使用主题渐变。"
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
              description="关闭后只播放一次，停在结束时间或最后一帧"
              className="sm:col-span-2"
            />
            <SwitchTile
              checked={hero.backgroundVideoFirstFromStart}
              onChange={(backgroundVideoFirstFromStart) => setHero({ backgroundVideoFirstFromStart })}
              label="第一遍从头播放"
              description="关闭后首轮直接从区间开始时间进入，之后每轮都从区间开始"
              className="sm:col-span-2"
            />
            <SecondsInput
              label="区间开始（秒）"
              value={hero.backgroundVideoStart}
              onChange={(backgroundVideoStart) => setHero({ backgroundVideoStart })}
              hint="循环回到这里；0 表示从头开始。"
            />
            <SecondsInput
              label="区间结束（秒）"
              value={hero.backgroundVideoEnd}
              onChange={(backgroundVideoEnd) => setHero({ backgroundVideoEnd })}
              hint="播到这里切回开始时间；0 表示播放到视频末尾。"
            />
          </div>
          {hero.backgroundVideoEnd > 0 && hero.backgroundVideoEnd <= hero.backgroundVideoStart && (
            <p className="text-xs text-warning">结束时间需大于开始时间，否则会按整段视频循环。</p>
          )}
        </Section>
      )}

      <Section title="尺寸与对齐" description="欢迎区的宽高与内容对齐" icon="dashboard">
        <SwitchTile
          checked={hero.fullScreen}
          onChange={(fullScreen) => setHero({ fullScreen })}
          label="铺满屏幕"
          description="全宽并占满整个视口高度；开启后将忽略下方宽度与高度"
        />
        {hero.fullScreen ? (
          <div className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-muted">
            <Icon name="info" size={15} className="shrink-0 text-brand" />
            当前为「铺满屏幕」模式，宽度与高度已锁定。
          </div>
        ) : (
          <>
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
            <Input
              label="高度"
              value={hero.height}
              onChange={(e) => setHero({ height: e.target.value })}
              placeholder="360px / 60vh，留空自适应"
            />
          </>
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

      <Section title="遮罩与文字" description="压暗背景保证可读性，并可单独指定文字颜色" icon="palette">
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
    </div>
  );
}