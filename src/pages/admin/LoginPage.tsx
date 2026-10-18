import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Icon } from '../../components/ui/icons';
import { useAuth } from '../../providers/AuthProvider';
import { useSettings } from '../../providers/SettingsProvider';
import { useToast } from '../../providers/ToastProvider';

export function LoginPage() {
  const { login } = useAuth();
  const { settings } = useSettings();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/admin';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username.trim(), password);
      success('登录成功');
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败';
      setError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-fg">
            {(settings.site.logo.text || settings.site.name).slice(0, 1).toUpperCase()}
          </span>
          <h1 className="text-xl font-bold text-fg">登录到管理后台</h1>
          <p className="mt-1 text-sm text-muted">{settings.site.name}</p>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-border bg-surface p-6 shadow-card">
          <div className="space-y-4">
            <Input
              label="用户名"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              label="密码"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="mt-4 flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              <Icon name="alert" size={16} />
              {error}
            </p>
          )}
          <Button type="submit" block className="mt-6" loading={loading}>
            登录
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-faint">
          <a href="/" className="hover:text-fg">
            返回网站首页
          </a>
        </p>
      </div>
    </div>
  );
}
