import { useEffect, useState } from 'react';
import type { ApiMeta, AuditLogEntry } from '@shared/types';
import { Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { Pagination } from '../../components/ui/Pagination';
import { api, qs } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../hooks';
import { useSettings } from '../../providers/SettingsProvider';

const ACTION_GROUPS = [
  { value: '', label: '全部操作' },
  { value: 'post', label: '文章' },
  { value: 'comment', label: '评论' },
  { value: 'media', label: '媒体' },
  { value: 'tag', label: '标签' },
  { value: 'setting', label: '设置' },
  { value: 'auth', label: '登录/账号' },
];

const ACTION_LABELS: Record<string, string> = {
  'post.create': '创建文章',
  'post.update': '更新文章',
  'post.trash': '移入回收站',
  'post.restore': '恢复文章',
  'post.purge': '彻底删除文章',
  'comment.status': '评论状态变更',
  'comment.delete': '删除评论',
  'comment.batch.approved': '批量通过评论',
  'comment.batch.rejected': '批量拒绝评论',
  'comment.batch.spam': '批量标记垃圾',
  'comment.batch.delete': '批量删除评论',
  'media.delete': '删除媒体',
  'tag.create': '创建标签',
  'tag.update': '更新标签',
  'tag.delete': '删除标签',
  'settings.update': '更新设置',
  'settings.reset': '重置设置',
  'auth.password_change': '修改密码',
  'auth.logout_all': '退出所有设备',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function AuditLogPage() {
  const { settings } = useSettings();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [filter, setFilter] = useState('');

  useDocumentTitle('审计日志', settings.site.name);

  useEffect(() => {
    setPage(1);
  }, [action]);

  const { data, loading } = useAsync(
    () => api.get<AuditLogEntry[]>(`/audit${qs({ page, perPage: 30, action: action || undefined })}`),
    [page, action],
  );

  const entries = data?.data ?? [];
  const meta: ApiMeta = data?.meta ?? {};
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? entries.filter(
        (e) =>
          (e.actor_name ?? '').toLowerCase().includes(needle) ||
          e.action.toLowerCase().includes(needle) ||
          (e.detail ?? '').toLowerCase().includes(needle),
      )
    : entries;

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">审计日志</h1>
          <p className="mt-1 text-sm text-muted">
            {meta.total != null ? `共 ${meta.total} 条记录` : '记录后台的重要操作'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            wrapperClassName="w-36"
            aria-label="按操作类型筛选"
          >
            {ACTION_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
          <Input
            type="search"
            placeholder="筛选本页..."
            value={filter}
            wrapperClassName="w-48"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </header>

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon="clock" title="没有记录" description="还没有符合条件的管理操作。" />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-faint">
                  <th className="px-4 py-3 font-medium">时间</th>
                  <th className="px-4 py-3 font-medium">操作者</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                  <th className="px-4 py-3 font-medium">对象</th>
                  <th className="px-4 py-3 font-medium">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((entry) => (
                  <tr key={entry.id} className="align-top transition-colors hover:bg-surface-2/50">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(entry.created_at)}</td>
                    <td className="px-4 py-3 text-fg">{entry.actor_name ?? '系统'}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-fg">{actionLabel(entry.action)}</span>
                      <span className="ml-1 font-mono text-[11px] text-faint">{entry.action}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {entry.target_type ? (
                        <span>
                          {entry.target_type}
                          {entry.target_id != null ? ` #${entry.target_id}` : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      {entry.detail ? (
                        <code
                          className="block truncate text-[11px] text-faint"
                          title={entry.detail}
                        >
                          {entry.detail}
                        </code>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Pagination
        className="mt-6"
        page={meta.page ?? 1}
        totalPages={meta.totalPages ?? 1}
        onChange={(p) => setPage(p)}
      />
    </div>
  );
}