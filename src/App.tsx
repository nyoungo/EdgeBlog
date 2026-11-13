import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RootLayout } from './components/layout/RootLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Centered, Spinner } from './components/ui/Feedback';
import { SettingsProvider } from './providers/SettingsProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ToastProvider } from './providers/ToastProvider';

import { HomePage } from './pages/HomePage';
import { PostListPage } from './pages/PostListPage';
import { ColumnsPage } from './pages/ColumnsPage';
import { TagsPage } from './pages/TagsPage';
import { ArchivePage } from './pages/ArchivePage';
import { SearchPage } from './pages/SearchPage';

/**
 * Anything that pulls the Markdown pipeline (marked + DOMPurify + highlight.js,
 * ~230 KB raw) is split behind a route boundary so the landing page never pays
 * for it. Only article-style pages trigger the download.
 */
const PostDetailPage = lazy(() => import('./pages/PostDetailPage').then((m) => ({ default: m.PostDetailPage })));
const ColumnDetailPage = lazy(() =>
  import('./pages/ColumnDetailPage').then((m) => ({ default: m.ColumnDetailPage })),
);
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const NotFoundPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.NotFoundPage })));

// Admin is split out — visitors never download it.
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const LoginPage = lazy(() => import('./pages/admin/LoginPage').then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PostsAdminPage = lazy(() => import('./pages/admin/PostsAdminPage').then((m) => ({ default: m.PostsAdminPage })));
const PostEditorPage = lazy(() => import('./pages/admin/PostEditorPage').then((m) => ({ default: m.PostEditorPage })));
const CommentsAdminPage = lazy(() => import('./pages/admin/CommentsAdminPage').then((m) => ({ default: m.CommentsAdminPage })));
const MediaAdminPage = lazy(() => import('./pages/admin/MediaAdminPage').then((m) => ({ default: m.MediaAdminPage })));
const AppearancePage = lazy(() => import('./pages/admin/AppearancePage').then((m) => ({ default: m.AppearancePage })));
const AiSettingsPage = lazy(() => import('./pages/admin/AiSettingsPage').then((m) => ({ default: m.AiSettingsPage })));
const AutomationPage = lazy(() =>
  import('./pages/admin/AutomationPage').then((m) => ({ default: m.AutomationPage })),
);
const AccountPage = lazy(() => import('./pages/admin/AccountPage').then((m) => ({ default: m.AccountPage })));
const TagsAdminPage = lazy(() => import('./pages/admin/TagsAdminPage').then((m) => ({ default: m.TagsAdminPage })));
const ColumnsAdminPage = lazy(() =>
  import('./pages/admin/ColumnsAdminPage').then((m) => ({ default: m.ColumnsAdminPage })),
);
const AuditLogPage = lazy(() => import('./pages/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));

function FullPageSpinner() {
  return (
    <Centered className="min-h-dvh">
      <Spinner />
    </Centered>
  );
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <Centered className="py-32">
          <Spinner />
        </Centered>
      }
    >
      {children}
    </Suspense>
  );
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<FullPageSpinner />}>{children}</Suspense>;
}

export function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Routes>
                <Route element={<RootLayout />}>
                  <Route index element={<HomePage />} />
                  <Route path="posts" element={<PostListPage />} />
                  <Route path="posts/:slug" element={<PublicRoute><PostDetailPage /></PublicRoute>} />
                  <Route path="columns" element={<ColumnsPage />} />
                  <Route
                    path="columns/:slug"
                    element={
                      <PublicRoute>
                        <ColumnDetailPage />
                      </PublicRoute>
                    }
                  />
                  <Route path="tags" element={<TagsPage />} />
                  <Route path="archive" element={<ArchivePage />} />
                  <Route path="search" element={<SearchPage />} />
                  <Route path="about" element={<PublicRoute><AboutPage /></PublicRoute>} />
                  <Route path="*" element={<PublicRoute><NotFoundPage /></PublicRoute>} />
                </Route>

                <Route
                  path="admin/login"
                  element={
                    <AdminRoute>
                      <LoginPage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="admin"
                  element={
                    <AdminRoute>
                      <AdminLayout />
                    </AdminRoute>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="posts" element={<PostsAdminPage />} />
                  <Route path="posts/new" element={<PostEditorPage />} />
                  <Route path="posts/:slug" element={<PostEditorPage />} />
                  <Route path="comments" element={<CommentsAdminPage />} />
                  <Route path="media" element={<MediaAdminPage />} />
                  <Route path="tags" element={<TagsAdminPage />} />
                  <Route path="columns" element={<ColumnsAdminPage />} />
                  <Route path="appearance" element={<AppearancePage />} />
                  <Route path="ai" element={<AiSettingsPage />} />
                  <Route path="automation" element={<AutomationPage />} />
                  <Route path="audit" element={<AuditLogPage />} />
                  <Route path="account" element={<AccountPage />} />
                </Route>
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
