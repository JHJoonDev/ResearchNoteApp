import { Component, Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import Layout from './components/Layout';
import Login from './pages/Login';
import useAuthStore from './store/useAuthStore';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ELN = lazy(() => import('./pages/ELN'));
const LIMS = lazy(() => import('./pages/LIMS'));
const Members = lazy(() => import('./pages/Members'));
const Settings = lazy(() => import('./pages/Settings'));
const Projects = lazy(() => import('./pages/Projects'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const Verify = lazy(() => import('./pages/Verify'));
const SearchResults = lazy(() => import('./pages/SearchResults'));
const ApprovalInbox = lazy(() => import('./pages/ApprovalInbox'));
const Protocols = lazy(() => import('./pages/Protocols'));
const PasswordReset = lazy(() => import('./pages/PasswordReset'));
const InvitationAccept = lazy(() => import('./pages/InvitationAccept'));
const Locations = lazy(() => import('./pages/Locations'));
const Entities = lazy(() => import('./pages/Entities'));
const ScanLabels = lazy(() => import('./pages/ScanLabels'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Webhooks = lazy(() => import('./pages/Webhooks'));
const InstrumentInbox = lazy(() => import('./pages/InstrumentInbox'));
class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="empty-state">
        <h1>화면을 불러오지 못했습니다.</h1>
        <p>기기에 저장된 초안은 유지됩니다.</p>
        <button className="btn-primary" onClick={() => window.location.reload()}>
          새로고침
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function ProtectedRoute() {
  const { isAuthenticated, initializing, error, initializeAuth } = useAuthStore();
  if (initializing) return <p className="empty-state">로그인 확인 중…</p>;
  if (!isAuthenticated && error)
    return (
      <main className="empty-state">
        <p role="alert">{error}</p>
        <button className="btn-primary" onClick={initializeAuth}>
          다시 연결
        </button>
      </main>
    );
  return isAuthenticated ? <Layout /> : <Navigate to="/login" replace />;
}
export default function App() {
  const { initializeAuth, user } = useAuthStore();
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<p className="empty-state">화면을 불러오는 중…</p>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/verify/:verifyId" element={<Verify />} />
            <Route path="/reset-password" element={<PasswordReset />} />
            <Route path="/invite" element={<InvitationAccept />} />
            <Route path="/search" element={<ProtectedRoute />}>
              <Route index element={<SearchResults />} />
            </Route>
            <Route path="/" element={<ProtectedRoute />}>
              <Route index element={<Dashboard />} />
              <Route path="eln" element={<ELN />} />
              <Route path="approvals" element={<ApprovalInbox />} />
              <Route path="protocols" element={<Protocols />} />
              <Route path="projects" element={<Projects />} />
              <Route path="lims" element={<LIMS />} />
              <Route path="members" element={<Members />} />
              <Route path="settings" element={<Settings />} />
              <Route path="locations" element={<Locations />} />
              <Route path="entities" element={<Entities />} />
              <Route path="scan" element={<ScanLabels />} />
              <Route path="api-keys" element={<ApiKeys />} />
              <Route path="inbox" element={<InstrumentInbox />} />
              <Route path="webhooks" element={user?.role === 'admin' ? <Webhooks /> : <Navigate to="/" replace />} />
              <Route
                path="audit-logs"
                element={user?.role === 'admin' ? <AuditLogs /> : <Navigate to="/" replace />}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
