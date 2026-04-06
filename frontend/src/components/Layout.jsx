import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';

function Layout() {
  const navigate = useNavigate();

  const logout = useAuthStore((state) => state.logout);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo">
          <i className="fa-solid fa-flask"></i>
          <span>LabHub</span>
        </div>
        <nav className="nav-menu">
          <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
            <i className="fa-solid fa-chart-pie"></i> 대시보드
          </NavLink>
          <NavLink to="/eln" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="fa-solid fa-book-journal-whills"></i> 연구노트 (ELN)
          </NavLink>
          <NavLink to="/lims" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="fa-solid fa-vials"></i> 시약 관리 (LIMS)
          </NavLink>
          <NavLink to="/members" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="fa-solid fa-users"></i> 연구실 멤버
          </NavLink>
        </nav>
        <div className="bottom-menu">
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="fa-solid fa-gear"></i> 시스템 설정
          </NavLink>
          <a href="#" className="nav-item" onClick={handleLogout} style={{ marginTop: '0.5rem', color: 'var(--danger)' }}>
            <i className="fa-solid fa-right-from-bracket"></i> 로그아웃
          </a>
        </div>
      </aside>
      
      <main className="main-content">
        <header className="top-header">
          <div className="search-bar">
            <i className="fa-solid fa-magnifying-glass"></i>
            <input type="text" placeholder="노트 기록, 시약명, 또는 프로토콜 검색..." />
          </div>
          <div className="user-profile">
            <div className="notification-icon">
              <i className="fa-regular fa-bell"></i>
              <span className="badge">3</span>
            </div>
            <img src="https://ui-avatars.com/api/?name=Senior+Dev&background=0D8ABC&color=fff" alt="User" />
          </div>
        </header>
        
        {/* Child Pages are rendered here */}
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
