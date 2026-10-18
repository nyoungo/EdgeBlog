import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AiSettingsView, MediaItem, PostDetail, PostStatus } from '@shared/types';
import { ApiError, api } from '../../lib/api';
import { parseSqlDate } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { Card, Centered, Spinner } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { MediaPicker } from '../../components/admin/MediaPicker';
import { MarkdownEditor } from '../../components/admin/MarkdownEditor';

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  contentMd: string;
  coverUrl: string;
  status: PostStatus;
  publishedAt: string;
  metaTitle: string;
  metaDescription: string;
  ogImage: string;
  featured: boolean;
  tags: string;
}

const EMPTY: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  contentMd: '',
  coverUrl: '',
  status: 'draft',
  publishedAt: '',
  metaTitle: '',
  metaDescription: '',
  ogImage: '',
  featured: false,
  tags: '',
};

const pad = (n: number) => String(n).padStart(2, '0');

function sqlToLocalInput(sql: string | null): string {
  const date = parseSqlDate(sql);
  if (!date) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toForm(post: PostDetail): FormState {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? '',
    contentMd: post.content_md ?? '',
    coverUrl: post.cover_url ?? '',
    status: post.status,
    publishedAt: sqlToLocalInput(post.published_at),
    metaTitle: post.meta_title ?? '',
    metaDescription: post.meta_description ?? '',
    ogImage: post.og_image ?? '',
    featured: post.featured === 1,
    tags: post.tags.map((t) => t.name).join(', '),
  };
}

export function PostEditorPage() {
  const { slug: routeSlug } = useParams();
  const editing = Boolean(routeSlug && routeSlug !== 'new');
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { success, error } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [postId, setPostId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(!editing);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<null | 'cover' | 'og'>(null);
  const [aiReady, setAiReady] = useState(false);
  const [aiBusy, setAiBusy] = useState<null | 'excerpt' | 'content'>(null);

  useDocumentTitle(editing ? '编辑文章' : '新建文章', settings.site.name);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AiSettingsView>('/ai/settings')
      .then(({ data }) => {
        if (!cancelled) setAiReady(data.enabled && data.hasApiKey);
      })
      .catch(() => {
        /* AI is optional — silently hide the helpers */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useAsync(async () => {
    if (!editing || !routeSlug) return null;
    try {
      const { data } = await api.get<PostDetail>(`/posts/${routeSlug}`);
      setForm(toForm(data));
      setPostId(data.id);
      return data;
    } catch (err) {
      error(err instanceof Error ? err.message : '加载文章失败');
      return null;
    } finally {
      setLoaded(true);
    }
  }, [routeSlug, editing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const generateAi = async (mode: 'excerpt' | 'content') => {
    if (mode === 'content' && !form.title.trim() && !form.contentMd.trim()) {
      error('请先填写标题或一些要点，再生成正文');
      return;
    }
    if (mode === 'excerpt' && !form.title.trim() && !form.contentMd.trim()) {
      error('请先填写标题或正文，再生成摘要');
      return;
    }
    setAiBusy(mode);
    try {
      const { data } = await api.post<{ text: string }>('/ai/generate', {
        mode,
        title: form.title.trim(),
        contentMd: form.contentMd,
      });
      const text = data.text.trim();
      if (mode === 'excerpt') {
        set('excerpt', text);
        success('摘要已生成');
      } else {
        const next = form.contentMd.trim() ? `${form.contentMd.trimEnd()}\n\n${text}\n` : `${text}\n`;
        set('contentMd', next);
        success('正文已生成');
      }
    } catch (err) {
      error(err instanceof Error ? err.message : 'AI 生成失败');
    } finally {
      setAiBusy(null);
    }
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.title.trim()) {
      error('标题不能为空');
      return;
    }
    if (form.status === 'scheduled' && !form.publishedAt) {
      error('定时发布需要设置发布时间');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim() || undefined,
        excerpt: form.excerpt.trim(),
        contentMd: form.contentMd,
        coverUrl: form.coverUrl.trim() || null,
        status: form.status,
        publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
        metaTitle: form.metaTitle.trim() || null,
        metaDescription: form.metaDescription.trim() || null,
        ogImage: form.ogImage.trim() || null,
        featured: form.featured,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      if (editing && postId) {
        await api.put<PostDetail>(`/posts/${postId}`, payload);
        success('文章已保存');
      } else {
        const { data } = await api.post<PostDetail>('/posts', payload);
        success('文章已创建');
        navigate(`/admin/posts/${data.slug}`, { replace: true });
      }
    } catch (err) {
      error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }

  const aiToolbar = aiReady ? (
    <>
      <button
        type="button"
        disabled={aiBusy !== null}
        onClick={() => void generateAi('content')}
        title="让 AI 依据标题/要点撰写正文，生成内容会追加到末尾"
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-60"
      >
        <Icon name="sparkles" size={13} />
        {aiBusy === 'content' ? '生成中…' : 'AI 生成正文'}
      </button>
    </>
  ) : null;

  return (
    <form onSubmit={submit} className="w-full pb-24">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/admin/posts" className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg" aria-label="返回">
            <Icon name="arrowLeft" size={18} />
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-fg">{editing ? '编辑文章' : '新建文章'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" loading={saving}>
            <Icon name="save" size={16} />
            保存
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <Input
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="文章标题"
            className="h-12 text-lg font-semibold"
            required
          />

          <MarkdownEditor
            value={form.contentMd}
            onChange={(next) => set('contentMd', next)}
            onSave={() => void submit()}
            extraToolbar={aiToolbar}
          />
        </div>

        <aside className="space-y-4">
          <Card className="space-y-4 p-4">
            <Select label="状态" value={form.status} onChange={(e) => set('status', e.target.value as PostStatus)}>
              <option value="draft">草稿</option>
              <option value="published">发布</option>
              <option value="scheduled">定时发布</option>
            </Select>
            <Input
              label={form.status === 'scheduled' ? '发布时间' : '发布时间（可选）'}
              type="datetime-local"
              value={form.publishedAt}
              onChange={(e) => set('publishedAt', e.target.value)}
              hint={form.status === 'published' && !form.publishedAt ? '留空则立即发布' : undefined}
            />
            <Switch
              checked={form.featured}
              onChange={(v) => set('featured', v)}
              label="设为精选"
              description="显示在首页精选模块"
            />
          </Card>

          <Card className="space-y-4 p-4">
            <Input
              label="Slug"
              value={form.slug}
              onChange={(e) => set('slug', e.target.value)}
              placeholder="自动根据标题生成"
              hint="留空自动生成"
            />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-fg">摘要</span>
                {aiReady && (
                  <button
                    type="button"
                    disabled={aiBusy !== null}
                    onClick={() => void generateAi('excerpt')}
                    title="让 AI 依据标题/正文撰写摘要"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-opacity hover:opacity-80 disabled:opacity-60"
                  >
                    <Icon name="sparkles" size={13} />
                    {aiBusy === 'excerpt' ? '生成中…' : 'AI 生成'}
                  </button>
                )}
              </div>
              <Textarea
                value={form.excerpt}
                onChange={(e) => set('excerpt', e.target.value)}
                rows={3}
                placeholder="留空自动摘取正文"
              />
            </div>
            <Input
              label="标签"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="用逗号分隔，如：React, 教程"
            />
          </Card>

          <Card className="space-y-4 p-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg">封面图</span>
              {form.coverUrl && (
                <img src={form.coverUrl} alt="封面预览" className="aspect-video w-full rounded-md border border-border object-cover" />
              )}
              <div className="flex gap-2">
                <Input
                  value={form.coverUrl}
                  onChange={(e) => set('coverUrl', e.target.value)}
                  placeholder="图片 URL"
                  wrapperClassName="flex-1"
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => setPicker('cover')} className="mt-0">
                  选择
                </Button>
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-4">
            <Input label="SEO 标题" value={form.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} placeholder="留空使用文章标题" />
            <Textarea
              label="SEO 描述"
              value={form.metaDescription}
              onChange={(e) => set('metaDescription', e.target.value)}
              rows={2}
              placeholder="留空使用摘要"
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg">分享图（OG）</span>
              <div className="flex gap-2">
                <Input value={form.ogImage} onChange={(e) => set('ogImage', e.target.value)} placeholder="图片 URL" wrapperClassName="flex-1" />
                <Button type="button" variant="secondary" size="sm" onClick={() => setPicker('og')}>
                  选择
                </Button>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <MediaPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={(item: MediaItem) => {
          if (picker === 'cover') set('coverUrl', item.url);
          else if (picker === 'og') set('ogImage', item.url);
        }}
      />
    </form>
  );
}
