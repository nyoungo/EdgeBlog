import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RootLayout } from './components/layout/RootLayout';
import { Centered, Spinner } from './components/ui/Feedback';
import { SettingsProvider } from './providers/SettingsProvider';
import { AuthProvider } from './providers/AuthProvider';
import { ToastProvider } from './providers/ToastProvider';

import { HomePage } from './pages/HomePage';
import { PostListPage } from './pages/PostListPage';
import { PostDetailPage } from './pages/PostDetailPage';
import { TagsPage } from './pages/TagsPage';
import { ArchivePage } from './pages/ArchivePage';
import { SearchPage } from './pages/SearchPage';
import { AboutPage, NotFoundPage } from './pages/AboutPage';

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

function FullPageSpinner() {
  return (
    <Centered className="min-h-dvh">
      <Spinner />
    </Centered>
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
            <Routes>
              <Route element={<RootLayout />}>
                <Route index element={<HomePage />} />
                <Route path="posts" element={<PostListPage />} />
                <Route path="posts/:slug" element={<PostDetailPage />} />
                <Route path="tags" element={<TagsPage />} />
                <Route path="archive" element={<ArchivePage />} />
                <Route path="search" element={<SearchPage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="*" element={<NotFoundPage />} />
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
                <Route path="appearance" element={<AppearancePage />} />
                <Route path="ai" element={<AiSettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
