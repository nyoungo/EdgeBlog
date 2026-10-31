import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Card } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/icons';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { api } from '../../lib/api';
import { useDocumentTitle } from '../../hooks';
import { useAuth } from '../../providers/AuthProvider';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

/**
 * Account + password management.
 *
 * `POST /api/auth/password` existed on the server from the start, but there was
 * no UI for it — the "still using the default password" warning on login told
 * the operator to change it somewhere that did not exist.
 */
export function AccountPage() {
  const { settings } = useSettings();
  const { user } = useAuth();
  const { success, error } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  useDocumentTitle('账号安全', settings.site.name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
      error('新密码至少 8 位,且需同时包含字母和数字');
      return;
    }
    if (next !== confirm) {
      error('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      success('密码已修改,其他设备上的登录已失效');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      error(err instanceof Error ? err.message : '修改失败');
    } finally {
      setSaving(false);
    }
  };

  const logoutEverywhere = async () => {
    setLoggingOutAll(true);
    try {
      await api.post('/auth/logout-all');
      success('已退出所有设备,请重新登录');
      // The cookie is already cleared server-side; a full reload drops any
      // cached admin state so the login page is shown cleanly.
      window.location.assign('/admin/login');
    } catch (err) {
      error(err instanceof Error ? err.message : '操作失败');
      setLoggingOutAll(false);
      setConfirmLogoutAll(false);
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-fg">账号安全</h1>
        <p className="mt-1 text-sm text-muted">管理当前管理员的登录凭据</p>
      </header>

      {/*
        Wide screens use a 12-column grid: identity + sessions stack in the
        left third while the password form takes the right two thirds, so the
        page uses the full content width instead of a narrow centred column.
        Source order stays identity → password → sessions for phones.
      */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="p-5 lg:col-span-4 lg:col-start-1 lg:row-start-1">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Icon name="lock" size={18} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{user?.display_name || user?.username}</p>
              <p className="truncate text-xs text-faint">
                {user?.username} · {user?.role === 'admin' ? '管理员' : '编辑'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-8 lg:col-start-5 lg:row-span-2 lg:row-start-1">
          <h2 className="text-sm font-semibold text-fg">修改密码</h2>
          <p className="mt-1 text-xs text-muted">
            修改后,其他设备/浏览器上的登录会立即失效(当前会话会保持登录)。
          </p>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <Input
              label="当前密码"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
            <Input
              label="新密码"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              hint="至少 8 位,需包含字母和数字"
              required
            />
            <Input
              label="确认新密码"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>
                <Icon name="save" size={16} />
                保存新密码
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-5 lg:col-span-4 lg:col-start-1 lg:row-start-2">
          <h2 className="text-sm font-semibold text-fg">登录会话</h2>
          <p className="mt-1 text-xs text-muted">
            如果怀疑账号在别处被登录,可以让所有设备立即退出。你当前这台设备也需要重新登录。
          </p>
          <div className="mt-4">
            <Button variant="outline" onClick={() => setConfirmLogoutAll(true)}>
              <Icon name="logout" size={16} />
              退出所有设备
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmLogoutAll}
        title="退出所有设备"
        description="将立即吊销所有设备上的登录会话(包括当前设备),之后需要用密码重新登录。"
        confirmLabel="全部退出"
        danger
        loading={loggingOutAll}
        onConfirm={logoutEverywhere}
        onClose={() => setConfirmLogoutAll(false)}
      />
    </div>
  );
}