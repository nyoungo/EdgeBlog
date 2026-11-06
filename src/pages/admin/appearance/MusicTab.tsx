import type { MusicPlayMode, MusicTrack } from '@shared/types';
import { Button } from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Field';
import { MediaField } from '../../../components/admin/MediaField';
import { Icon } from '../../../components/ui/icons';
import { useAppearance } from './context';
import { IconButton, Row, Section, Segmented, SwitchTile } from './ui';

export function MusicTab() {
  const { draft, setMusic, pickMedia } = useAppearance();
  const { music } = draft;

  const updateTrack = (index: number, patch: Partial<MusicTrack>) =>
    setMusic({ playlist: music.playlist.map((track, i) => (i === index ? { ...track, ...patch } : track)) });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title="悬浮播放器"
        description="默认关闭，开启后仅在访客前台懒加载"
        icon="music"
      >
        <SwitchTile
          checked={music.enabled}
          onChange={(enabled) => setMusic({ enabled })}
          label="启用音乐播放器"
          description="开启后访客页面会出现悬浮播放器"
        />
        <Row label="界面语言">
          <Segmented
            value={music.language}
            onChange={(language) => setMusic({ language })}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Row>
        <Select
          label="播放模式"
          value={music.playMode}
          onChange={(e) => setMusic({ playMode: e.target.value as MusicPlayMode })}
          wrapperClassName="sm:max-w-[12rem]"
        >
          <option value="order">顺序播放</option>
          <option value="single">单曲循环</option>
          <option value="random">随机播放</option>
        </Select>
      </Section>

      <Section title="数据源" description="云端接口拉取歌单，或使用本地歌单" icon="globe">
        <Row label="数据源">
          <Segmented
            value={music.mode}
            onChange={(mode) => setMusic({ mode })}
            options={[
              { value: 'cloud', label: '云端接口' },
              { value: 'local', label: '本地歌单' },
            ]}
          />
        </Row>

        {music.mode === 'cloud' ? (
          <Input
            label="歌单接口（apiUrl）"
            value={music.apiUrl}
            onChange={(e) => setMusic({ apiUrl: e.target.value })}
            placeholder="https://music.api.xfyun.club/api/v1/music/top?platform=netease&topId=3778678"
            hint="需返回 { code, msg, data: [...] } 结构；播放器将在访客端请求该接口。"
          />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-fg">本地歌单</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setMusic({
                    playlist: [
                      ...music.playlist,
                      {
                        id: `track-${Date.now().toString(36)}`,
                        title: '新歌曲',
                        artist: '',
                        cover: '',
                        src: '',
                      },
                    ],
                  })
                }
              >
                <Icon name="plus" size={15} /> 添加歌曲
              </Button>
            </div>
            {music.playlist.length === 0 && <p className="text-xs text-faint">暂无歌曲，点击「添加歌曲」。</p>}
            {music.playlist.map((track, i) => (
              <div key={track.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={track.title}
                    aria-label="歌曲标题"
                    placeholder="标题"
                    wrapperClassName="min-w-[8rem] flex-1"
                    onChange={(e) => updateTrack(i, { title: e.target.value })}
                  />
                  <Input
                    value={track.artist ?? ''}
                    aria-label="歌手"
                    placeholder="歌手"
                    wrapperClassName="w-28"
                    onChange={(e) => updateTrack(i, { artist: e.target.value })}
                  />
                  <IconButton
                    icon="trash"
                    label="删除歌曲"
                    tone="danger"
                    onClick={() => setMusic({ playlist: music.playlist.filter((_, idx) => idx !== i) })}
                  />
                </div>
                <Input
                  value={track.src}
                  aria-label="音频地址"
                  placeholder="音频地址 https://… 或 /media/…"
                  onChange={(e) => updateTrack(i, { src: e.target.value })}
                />
                <MediaField
                  label="封面（可选）"
                  value={track.cover ?? ''}
                  placeholder="https://… 或 /media/…"
                  preview={false}
                  onChange={(cover) => updateTrack(i, { cover })}
                  onPick={() => pickMedia('image', (item) => updateTrack(i, { cover: item.url }))}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="外观与交互" description="主题、尺寸与视觉选项" icon="palette" className="xl:col-span-2">
        <Select
          label="主题"
          value={music.theme}
          onChange={(e) => setMusic({ theme: e.target.value })}
          hint="播放器强调色跟随博客主题色；auto-theme 跟随博客亮暗模式。"
          wrapperClassName="sm:max-w-md"
        >
          <option value="auto-theme">跟随博客亮暗（auto-theme）</option>
          <option value="xf-original-theme">原始 · 浅色</option>
          <option value="xf-theme">默认</option>
          <option value="xf-dark-theme">暗色</option>
          <option value="xf-orange-theme">橙色</option>
          <option value="xf-pink-theme">粉色</option>
          <option value="xf-sky-theme">天空</option>
          <option value="xf-dark-green-theme">墨绿</option>
          <option value="xf-wine-theme">酒红</option>
          <option value="random-theme">随机</option>
        </Select>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input
            label="播放器宽度"
            value={music.playerWidth}
            onChange={(e) => setMusic({ playerWidth: e.target.value })}
          />
          <Input
            label="底部距离"
            value={music.bottom}
            onChange={(e) => setMusic({ bottom: e.target.value })}
          />
          <Input
            label="歌单高度"
            value={music.songListHeight}
            onChange={(e) => setMusic({ songListHeight: e.target.value })}
          />
          <Input
            label="歌单可视数量"
            type="number"
            min={1}
            max={20}
            value={music.visibleSongListCount}
            onChange={(e) =>
              setMusic({
                visibleSongListCount: Math.min(20, Math.max(1, Math.round(Number(e.target.value)) || 4)),
              })
            }
          />
        </div>
        <Input
          label="音量"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={music.volume}
          onChange={(e) => setMusic({ volume: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })}
          hint="0–1"
          wrapperClassName="sm:max-w-[10rem]"
        />
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          <SwitchTile
            checked={music.isAutoPopup}
            onChange={(isAutoPopup) => setMusic({ isAutoPopup })}
            label="自动展开播放器"
            description="仅展开界面，不触发播放"
          />
          <SwitchTile
            checked={music.isAutoPlaylist}
            onChange={(isAutoPlaylist) => setMusic({ isAutoPlaylist })}
            label="默认展开歌单"
          />
          <SwitchTile
            checked={music.autoplay}
            onChange={(autoplay) => setMusic({ autoplay })}
            label="自动播放"
            description="受浏览器策略限制，通常需要访客先点击页面"
          />
          <SwitchTile
            checked={music.colorfulLyric}
            onChange={(colorfulLyric) => setMusic({ colorfulLyric })}
            label="彩色歌词"
          />
          <SwitchTile
            checked={music.audioVisualizer}
            onChange={(audioVisualizer) => setMusic({ audioVisualizer })}
            label="音频可视化"
            description="波形进度条（需音频允许跨域分析）"
          />
          <SwitchTile
            checked={music.rememberPlayback}
            onChange={(rememberPlayback) => setMusic({ rememberPlayback })}
            label="记忆播放"
            description="记住上次的歌曲与进度"
          />
        </div>
      </Section>
    </div>
  );
}