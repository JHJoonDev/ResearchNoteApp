import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import useAppStore from '../store/useAppStore';
import NotificationBell from './NotificationBell';
import AiStatusContext from '../contexts/AiStatusContext';
import { loadAiStatus } from '../lib/aiStatus';
export default function Layout() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { error, clearError } = useAppStore();
  const [aiStatus, setAiStatus] = useState({ enabled: false, features: [] });
  const [search, setSearch] = useState(''),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    let active = true;
    if (user?.id) loadAiStatus(user.id).then((status) => active && setAiStatus(status));
    return () => { active = false; };
  }, [user?.id]);
  const links = [
    ['/', '◷', '대시보드'],
    ['/eln', '▤', '연구노트'],
    ['/projects', '▦', '프로젝트'],
    ['/protocols', '☷', '프로토콜'],
    ['/approvals', '✓', '검토함'],
    ['/lims', '⚗', '시약 관리'],
    ['/locations', '⌂', '보관 위치'],
    ['/entities', '▣', '샘플·장비'],
    ['/scan', '▦', '라벨 스캔'],
    ['/inbox', '⇩', '기기 수집함'],
    ['/api-keys', '⚿', 'API 키'],
    ['/members', '◎', '연구실 멤버'],
    ...(user.role === 'admin' ? [['/webhooks', '↗', '웹훅'], ['/audit-logs', '≡', '감사 로그']] : []),
  ];
  return (
    <AiStatusContext.Provider value={aiStatus}>
    <div className="app-container">
      <a href="#page-content" className="skip-link">
        본문으로 이동
      </a>
      <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
        <button
          className="btn-outline mobile-menu"
          aria-label="메뉴 닫기"
          onClick={() => setMenu(false)}
        >
          ×
        </button>
        <div className="logo">
          <span>▤</span>
          <span>LabHub</span>
        </div>
        <p className="sidebar-caption">연구를 연결하는 기록</p>
        <nav className="nav-menu" aria-label="주 메뉴">
          {links.map(([to, icon, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMenu(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="bottom-menu">
          <NavLink className="nav-item" to="/settings" onClick={() => setMenu(false)}>
            ⚙ 계정 및 데이터
          </NavLink>
          <button
            className="nav-item logout-button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            ↪ 로그아웃
          </button>
        </div>
      </aside>
      <main className="main-content" id="page-content">
        <header className="top-header">
          <button
            className="btn-outline mobile-menu"
            aria-expanded={menu}
            aria-label="메뉴 열기"
            onClick={() => setMenu(!menu)}
          >
            ☰
          </button>
          <form
            className="search-bar"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/search?q=${encodeURIComponent(search.trim())}`);
            }}
          >
            <input
              aria-label="전체 연구노트 검색"
              placeholder="연구노트 검색 후 Enter"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="search-submit" aria-label="검색">
              ⌕
            </button>
          </form>
          <NotificationBell />
          <div className="user-profile">
            <div>
              <strong>{user.name}</strong>
              <small className="role-label">
                {user.role === 'admin'
                  ? '관리자'
                  : user.role === 'researcher'
                    ? '연구원'
                    : '읽기 전용'}
              </small>
            </div>
            <span className="avatar">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        {error && (
          <div className="error-banner global-error" role="alert">
            {error}
            <button onClick={clearError} aria-label="오류 닫기">
              ×
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
    </AiStatusContext.Provider>
  );
}
