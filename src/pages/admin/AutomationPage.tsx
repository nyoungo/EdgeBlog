import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AutomationCoverMode, AutomationPublishMode, AutomationRecurrence, AutomationTaskView, ColumnSummary } from '@shared/types';
import {
  computeNextRun,
  RECURRENCE_LABELS,
  WEEKDAY_LABELS,
  type ScheduleInput,
} from '@shared/schedule';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { MediaPicker } from '../../components/admin/MediaPicker';
import { api } from '../../lib/api';
import { formatUtc8 } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

/** 北京时间的今天，作为「起始日期」默认值。 */
function todayUtc8(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`;
}

interface FormState {
  name: string;
  prompt: string;
  columnId: string;
  tags: string;
  coverMode: AutomationCoverMode;
  coverPrompt: string;
  coverUrl: string;
  publishMode: AutomationPublishMode;
  recurrence: AutomationRecurrence;
  timeOfDay: string;
  weekday: string;
  dayOfMonth: string;
  startDate: string;
  endDate: string;
  enabled: boolean;
}

function emptyForm(): FormState {
  return {
    name: '',
    prompt: '',
    columnId: '',
    tags: '',
    coverMode: 'ai',
    coverPrompt: '',
    coverUrl: '',
    publishMode: 'draft',
    recurrence: 'daily',
    timeOfDay: '09:00',
    weekday: '1',
    dayOfMonth: '1',
    startDate: todayUtc8(),
    endDate: '',
    enabled: true,
  };
}

function toForm(task: AutomationTaskView): FormState {
  return {
    name: task.name,
    prompt: task.prompt,
    columnId: task.column_id != null ? String(task.column_id) : '',
    tags: task.tags.join(', '),
    coverMode: task.cover_mode,
    coverPrompt: task.cover_prompt,
    coverUrl: task.cover_url ?? '',
    publishMode: task.publish_mode,
    recurrence: task.recurrence,
    timeOfDay: task.time_of_day,
    weekday: String(task.weekday),
    dayOfMonth: String(task.day_of_month),
    startDate: task.start_date,
    endDate: task.end_date ?? '',
    enabled: task.enabled === 1,
  };
}

function scheduleOf(form: FormState): ScheduleInput {
  return {
    recurrence: form.recurrence,
    timeOfDay: form.timeOfDay,
    weekday: Number.parseInt(form.weekday, 10) || 0,
    dayOfMonth: Number.parseInt(form.dayOfMonth, 10) || 1,
    startDate: form.startDate,
    endDate: form.endDate.trim() || null,
  };
}

const LAST_STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  success: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  running: { label: '执行中', tone: 'warning' },
};

/**
 * 定时自动写文：按「周期 + 起止」配置任务，Worker 定时器到点执行，
 * 生成正文与封面，并按任务配置保存为草稿或直接发布。
 * 所有时间按北京时间（UTC+8）填写与展示。
 */
export function AutomationPage() {
  const { settings } = useSettings();
  const { success, error } = useToast();
  useDocumentTitle('定时发文', settings.site.name);

  const { data, loading, error: loadError, reload } = useAsync(
    () => api.get<AutomationTaskView[]>('/automation').then((r) => r.data),
    [],
  );
  const columns = useAsync(
    () => api.get<ColumnSummary[]>('/columns/admin').then((r) => r.data),
    [],
  );

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AutomationTaskView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState<AutomationTaskView | null>(null);

  const rows = data ?? [];
  const columnOptions = columns.data ?? [];

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const previewNext = useMemo(() => computeNextRun(scheduleOf(form), new Date()), [form]);

  const openCreate = () => {
    setForm(emptyForm());
    setDialog({ mode: 'create' });
  };

  const openEdit = (task: AutomationTaskView) => {
    setForm(toForm(task));
    setDialog({ mode: 'edit', id: task.id });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dialog) return;
    if (!form.name.trim()) return error('任务名称不能为空');
    if (!form.prompt.trim()) return error('写作要求不能为空');
    if (form.coverMode === 'fallback' && !form.coverUrl.trim()) {
      return error('指定封面需要填写图片地址');
    }

    const payload = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      columnId: form.columnId ? Number.parseInt(form.columnId, 10) : null,
      tags: form.tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      coverMode: form.coverMode,
      coverPrompt: form.coverPrompt.trim(),
      coverUrl: form.coverMode === 'fallback' ? form.coverUrl.trim() : form.coverUrl.trim() || null,
      publishMode: form.publishMode,
      recurrence: form.recurrence,
      timeOfDay: form.timeOfDay,
      weekday: Number.parseInt(form.weekday, 10) || 0,
      dayOfMonth: Number.parseInt(form.dayOfMonth, 10) || 1,
      startDate: form.startDate,
      endDate: form.endDate.trim() || null,
      enabled: form.enabled,
    };

    setSaving(true);
    try {
      if (dialog.mode === 'create') {
        await api.post('/automation', payload);
        success('任务已创建');
      } else {
        await api.put(`/automation/${dialog.id}`, payload);
        success('任务已更新');
      }
      setDialog(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (task: AutomationTaskView) => {
    setRunning(task.id);
    try {
      const result = await api.post<{ status: string; message: string }>(`/automation/${task.id}/run`);
      if (result.data.status === 'success') success(result.data.message);
      else error(result.data.message);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '执行失败');
    } finally {
      setRunning(null);
    }
  };

  const toggleEnabled = async (task: AutomationTaskView) => {
    try {
      await api.put(`/automation/${task.id}`, { enabled: task.enabled !== 1 });
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/automation/${pendingDelete.id}`);
      success('任务已删除');
      setPendingDelete(null);
      reload();
    } catch (err) {
      error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">定时发文</h1>
          <p className="mt-1 text-sm text-muted">
            到点自动用 AI 生成文章与封面，按任务设置保存为草稿或直接发布；时间按北京时间（UTC+8）。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Icon name="plus" size={16} />
          新建任务
        </Button>
      </header>

      {loadError ? (
        <ErrorState description={loadError} onRetry={reload} />
      ) : loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="wand"
          title="还没有定时任务"
          description="创建一个任务，写清楚主题与要求，剩下的交给定时器。"
          action={
            <button type="button" onClick={openCreate} className="text-sm font-medium text-brand hover:underline">
              新建任务
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((task) => {
            const status = task.last_status ? LAST_STATUS[task.last_status] : null;
            return (
              <Card key={task.id} className="p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg">{task.name}</span>
                      {task.enabled === 1 ? (
                        <Badge tone="success">已启用</Badge>
                      ) : (
                        <Badge tone="neutral">已暂停</Badge>
                      )}
                      <Badge tone="brand">{RECURRENCE_LABELS[task.recurrence]}</Badge>
                      {task.column ? (
                        <Badge tone="outline">专栏 · {task.column.name}</Badge>
                      ) : (
                        <Badge tone="outline">博客</Badge>
                      )}
                      <Badge tone={task.publish_mode === 'publish' ? 'brand' : 'neutral'}>
                        {task.publish_mode === 'publish' ? '直接发布' : '存草稿'}
                      </Badge>
                      {status && <Badge tone={status.tone}>{status.label}</Badge>}
                    </div>

                    <p className="mt-1 line-clamp-2 text-sm text-muted">{task.prompt}</p>

                    <p className="mt-1.5 text-xs text-faint">
                      下次运行：{task.enabled === 1 && task.next_run_at ? formatUtc8(task.next_run_at) : '未排期'}
                      {task.last_run_at && ` · 上次运行：${formatUtc8(task.last_run_at)}`}
                      {task.end_date && ` · 至 ${task.end_date}`}
                    </p>

                    {task.last_status === 'failed' && task.last_error && (
                      <p className="mt-1 text-xs text-danger">上次失败：{task.last_error}</p>
                    )}
                    {task.last_post && (
                      <p className="mt-1 text-xs text-faint">
                        最近产出：
                        <Link
                          to={`/admin/posts/${task.last_post.slug}`}
                          className="text-brand hover:underline"
                        >
                          {task.last_post.title}
                        </Link>
                        <StatusBadge status={task.last_post.status} className="ml-2 align-middle" />
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={running === task.id}
                      onClick={() => void runNow(task)}
                      title="立即执行一次"
                    >
                      <Icon name="zap" size={15} />
                      立即执行
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setHistory(task)} title="运行记录">
                      <Icon name="clock" size={15} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void toggleEnabled(task)}
                      title={task.enabled === 1 ? '暂停' : '启用'}
                    >
                      <Icon name={task.enabled === 1 ? 'pause' : 'play'} size={15} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(task)} title="编辑">
                      <Icon name="pencil" size={15} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingDelete(task)}
                      title="删除"
                      className="text-danger hover:bg-danger/10 hover:text-danger"
                    >
                      <Icon name="trash" size={15} />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'edit' ? '编辑任务' : '新建任务'}
        description="填写主题与要求，选择生成目标和运行周期。"
        className="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button loading={saving} onClick={() => void submit()}>
              保存
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Input
            label="任务名称"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="例如：每日 Cloudflare 观察"
            maxLength={120}
            required
          />
          <Select
            label="生成到"
            value={form.columnId}
            onChange={(e) => set('columnId', e.target.value)}
            hint={columnOptions.length === 0 ? '暂无专栏可选' : undefined}
          >
            <option value="">博客</option>
            {columnOptions.map((column) => (
              <option key={column.id} value={String(column.id)}>
                {column.name}
              </option>
            ))}
          </Select>

          <Textarea
            label="写作要求"
            value={form.prompt}
            onChange={(e) => set('prompt', e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="说明文章主题、角度、篇幅等，AI 会据此生成完整文章。"
            required
            wrapperClassName="sm:col-span-2"
          />

          <Input
            label="标签（选填）"
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="以逗号分隔，仅博客文章生效"
            hint="专栏文章不参与标签体系"
            wrapperClassName="sm:col-span-2"
          />

          <Select
            label="封面"
            value={form.coverMode}
            onChange={(e) => set('coverMode', e.target.value as AutomationCoverMode)}
          >
            <option value="ai">AI 生成封面</option>
            <option value="agent">AI 联网找图</option>
            <option value="fallback">指定图片</option>
            <option value="none">不设封面</option>
          </Select>
          {form.coverMode === 'agent' && (
            <p className="text-xs text-faint sm:col-span-2">
              AI 会联网搜索图片并存入媒体库;失败时不带封面,文章照常生成。
            </p>
          )}
          {(form.coverMode === 'ai' || form.coverMode === 'agent') && (
            <Input
              label="封面提示（选填）"
              value={form.coverPrompt}
              onChange={(e) => set('coverPrompt', e.target.value)}
              placeholder="留空则用文章标题生成"
              maxLength={2000}
            />
          )}
          {form.coverMode === 'fallback' && (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-sm font-medium text-fg">封面地址</span>
              <p className="text-xs text-faint">
                从媒体库选择,或粘贴图片直链;执行时会自动下载到本站媒体库。
              </p>
              <div className="flex gap-2">
                <Input
                  value={form.coverUrl}
                  onChange={(e) => set('coverUrl', e.target.value)}
                  placeholder="https://… 或 /media/…"
                  wrapperClassName="flex-1"
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => setPicker(true)}>
                  选择
                </Button>
              </div>
              {form.coverUrl && (
                <img
                  src={form.coverUrl}
                  alt="封面预览"
                  className="mt-1 aspect-[21/9] w-full max-w-sm rounded-xl object-cover ring-1 ring-fg/10"
                />
              )}
            </div>
          )}

          <Select
            label="生成后"
            value={form.publishMode}
            onChange={(e) => set('publishMode', e.target.value as AutomationPublishMode)}
            hint={form.publishMode === 'publish' ? '到点生成后直接上线，前台立即可见' : '保存为草稿，人工审核后再发布'}
          >
            <option value="draft">保存为草稿</option>
            <option value="publish">直接发布上线</option>
          </Select>

          <div className="grid gap-4 rounded-xl bg-surface-2/50 p-3 sm:col-span-2 sm:grid-cols-2">
            <Select
              label="周期"
              value={form.recurrence}
              onChange={(e) => set('recurrence', e.target.value as AutomationRecurrence)}
            >
              <option value="once">仅一次</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </Select>
            <Input
              label="执行时间"
              type="time"
              value={form.timeOfDay}
              onChange={(e) => set('timeOfDay', e.target.value)}
              hint="北京时间"
            />
            {form.recurrence === 'weekly' && (
              <Select label="星期" value={form.weekday} onChange={(e) => set('weekday', e.target.value)}>
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={String(index)}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
            {form.recurrence === 'monthly' && (
              <Input
                label="每月第几天"
                type="number"
                min={1}
                max={31}
                value={form.dayOfMonth}
                onChange={(e) => set('dayOfMonth', e.target.value)}
              />
            )}
            <Input
              label="起始日期"
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              hint="北京时间"
            />
            <Input
              label="结束日期（选填）"
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
              hint="留空表示长期运行"
            />
            <p className="text-xs text-faint sm:col-span-2">
              下次运行：
              {form.enabled
                ? previewNext
                  ? formatUtc8(previewNext)
                  : '没有后续运行时间（请检查起止日期）'
                : '任务已暂停'}
            </p>
          </div>

          <div className="sm:col-span-2">
            <Switch
              checked={form.enabled}
              onChange={(v) => set('enabled', v)}
              label="启用任务"
              description="暂停后定时器会跳过该任务，可随时重新启用"
            />
          </div>
        </form>
      </Modal>

      <MediaPicker
        open={picker}
        onClose={() => setPicker(false)}
        onSelect={(item) => set('coverUrl', item.url)}
      />

      <RunHistoryModal task={history} onClose={() => setHistory(null)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除任务"
        description={
          pendingDelete
            ? `确定要删除「${pendingDelete.name}」吗？已生成的文章会保留，运行记录将被清除。`
            : ''
        }
        confirmLabel="删除"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

interface RunRow {
  id: number;
  status: 'success' | 'failed';
  message: string | null;
  post_id: number | null;
  post_slug: string | null;
  cover_url: string | null;
  finished_at: string;
}

function RunHistoryModal({ task, onClose }: { task: AutomationTaskView | null; onClose: () => void }) {
  const { data, loading, error } = useAsync(
    () =>
      task
        ? api.get<{ runs: RunRow[] }>(`/automation/${task.id}/runs`).then((r) => r.data)
        : Promise.resolve(null),
    [task?.id],
  );

  return (
    <Modal
      open={task !== null}
      onClose={onClose}
      title="运行记录"
      description={task?.name}
      className="max-w-2xl"
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} />
      ) : !data || data.runs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">暂无运行记录</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.runs.map((run) => (
            <li key={run.id} className="flex items-start gap-3 py-3">
              <Badge tone={run.status === 'success' ? 'success' : 'danger'} className="mt-0.5 shrink-0">
                {run.status === 'success' ? '成功' : '失败'}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{run.message || '—'}</p>
                <p className="mt-0.5 text-xs text-faint">{formatUtc8(run.finished_at)}</p>
                {run.status === 'success' && run.post_slug && (
                  <Link
                    to={`/admin/posts/${run.post_slug}`}
                    onClick={onClose}
                    className="text-xs text-brand hover:underline"
                  >
                    查看文章
                  </Link>
                )}
              </div>
              {run.cover_url && (
                <img
                  src={run.cover_url}
                  alt=""
                  loading="lazy"
                  className="h-12 w-20 shrink-0 rounded-md object-cover"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
