import { createElement, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, NotebookPen, Folders, ListChecks, ClipboardCheck, FlaskConical, MapPin, Boxes, ScanLine, Inbox, KeyRound, Users, Webhook, ScrollText, Settings, LogOut, PanelLeftClose, PanelLeftOpen, Menu, X, Search } from 'lucide-react';
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
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('labhub.sidebar.collapsed') === 'true'; } catch { return false; }
  });
  const searchInput = useRef(null);
  const profileMenu = useRef(null);
  useEffect(() => {
    let active = true;
    if (user?.id) loadAiStatus(user.id).then((status) => active && setAiStatus(status));
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    try { localStorage.setItem('labhub.sidebar.collapsed', String(collapsed)); } catch { /* Storage may be disabled. */ }
  }, [collapsed]);
  useEffect(() => {
    const keydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === 'Escape') { setMenu(false); setProfile(false); }
    };
    const outside = (event) => {
      if (!profileMenu.current?.contains(event.target)) setProfile(false);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);
  const signOut = async () => { await logout(); navigate('/login'); };
  const role = user.role === 'admin' ? '관리자' : user.role === 'researcher' ? '연구원' : '읽기 전용';
  const groups = [
    { links: [['/', LayoutDashboard, '대시보드'], ['/eln', NotebookPen, '연구노트'], ['/projects', Folders, '프로젝트'], ['/protocols', ListChecks, '프로토콜'], ['/approvals', ClipboardCheck, '검토함']] },
    { caption: '재고·장비', links: [['/lims', FlaskConical, '시약 관리'], ['/locations', MapPin, '보관 위치'], ['/entities', Boxes, '샘플·장비'], ['/scan', ScanLine, '라벨 스캔'], ['/inbox', Inbox, '기기 수집함']] },
    { caption: '연구실', links: [['/members', Users, '연구실 멤버'], ['/api-keys', KeyRound, 'API 키'], ...(user.role === 'admin' ? [['/webhooks', Webhook, '웹훅'], ['/audit-logs', ScrollText, '감사 로그']] : [])] },
  ];
  return <AiStatusContext.Provider value={aiStatus}>
    <div className={`app-container ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <a href="#page-content" className="skip-link">본문으로 이동</a>
      {menu && <button className="sidebar-scrim no-print" aria-label="메뉴 배경 닫기" onClick={() => setMenu(false)} />}
      <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
        <div className="sidebar-brand-row">
          <NavLink to="/" className="logo" aria-label="LabHub 홈" onClick={() => setMenu(false)}><span className="brand-tile"><FlaskConical aria-hidden="true" /></span><span className="brand-wordmark">LabHub</span></NavLink>
          <button type="button" className="btn-icon sidebar-collapse" title={collapsed ? '사이드바 펼치기' : '사이드바 접기'} aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
          <button type="button" className="btn-icon mobile-menu" aria-label="메뉴 닫기" onClick={() => setMenu(false)}><X aria-hidden="true" /></button>
        </div>
        <p className="sidebar-caption">연구를 연결하는 기록</p>
        <nav className="nav-menu" aria-label="주 메뉴">
          {groups.map((group, index) => <div className="nav-group" key={group.caption || index}>
            {group.caption && <p className="nav-group-caption">{group.caption}</p>}
            {group.links.map(([to, icon, label]) => <NavLink key={to} to={to} end={to === '/'} title={label} aria-label={label}
              onClick={() => setMenu(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>{createElement(icon, { 'aria-hidden': true })}<span className="nav-label">{label}</span></NavLink>)}
          </div>)}
        </nav>
        <div className="bottom-menu">
          <NavLink className="nav-item" to="/settings" title="계정 및 데이터" aria-label="계정 및 데이터" onClick={() => setMenu(false)}><Settings aria-hidden="true" /><span className="nav-label">계정 및 데이터</span></NavLink>
          <button className="nav-item logout-button" title="로그아웃" aria-label="로그아웃" onClick={signOut}><LogOut aria-hidden="true" /><span className="nav-label">로그아웃</span></button>
        </div>
      </aside>
      <main className="main-content" id="page-content" tabIndex={-1}>
        <header className="top-header">
          <button className="btn-icon mobile-menu" aria-expanded={menu} aria-label="메뉴 열기" onClick={() => setMenu(!menu)}><Menu aria-hidden="true" /></button>
          <form className="search-bar" onSubmit={(event) => { event.preventDefault(); navigate(`/search?q=${encodeURIComponent(search.trim())}`); }}>
            <button className="search-submit" aria-label="검색"><Search aria-hidden="true" /></button>
            <input ref={searchInput} aria-label="전체 연구노트 검색" placeholder="연구노트 검색 후 Enter" value={search} onChange={(event) => setSearch(event.target.value)} />
            <kbd className="search-shortcut" aria-hidden="true">Ctrl K</kbd>
          </form>
          <NotificationBell />
          <div className="user-profile" ref={profileMenu}>
            <button className="avatar" type="button" aria-label="계정 메뉴" aria-expanded={profile} aria-controls="account-menu" onClick={() => setProfile(!profile)}>{user.name.slice(0, 1)}</button>
            {profile && <section className="account-popover" id="account-menu" aria-label="계정 메뉴">
              <div className="account-summary"><strong>{user.name}</strong><small className="role-label">{role}</small></div>
              <NavLink to="/settings" onClick={() => setProfile(false)}><Settings aria-hidden="true" />계정 및 데이터</NavLink>
              <button className="btn-ghost" onClick={signOut}><LogOut aria-hidden="true" />로그아웃</button>
            </section>}
          </div>
        </header>
        {error && <div className="error-banner global-error" role="alert">{error}<button className="btn-icon" onClick={clearError} aria-label="오류 닫기"><X aria-hidden="true" /></button></div>}
        <Outlet />
      </main>
    </div>
  </AiStatusContext.Provider>;
}
