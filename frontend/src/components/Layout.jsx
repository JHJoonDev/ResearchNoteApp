import React, { useEffect, useState, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import useAppStore from '../store/useAppStore';

function Layout() {
  const navigate = useNavigate();

  const logout = useAuthStore((state) => state.logout);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const { notifications, fetchNotifications, markNotificationAsRead } = useAppStore();
  const user = useAuthStore((state) => state.user);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const notifMenuRef = useRef(null);

  useEffect(() => {
    if (user) {
      fetchNotifications(user.name, user.elnRole);
      // Periodically check for notifications every 30 seconds
      const interval = setInterval(() => {
        fetchNotifications(user.name, user.elnRole);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [user, fetchNotifications]);

  // Click outside to close notification menu
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifMenuRef.current && !notifMenuRef.current.contains(event.target)) {
        setShowNotifMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleNotifClick = (notif) => {
    markNotificationAsRead(notif._id);
    if (notif.link) navigate(notif.link);
    setShowNotifMenu(false);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="app-container">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
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
          <NavLink to="/members" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
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
          <button className="mobile-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <i className="fa-solid fa-bars"></i>
          </button>
          <div className="search-bar">
            <i className="fa-solid fa-magnifying-glass"></i>
            <input type="text" placeholder="노트 기록, 시약명, 또는 프로토콜 검색..." />
          </div>
          <div className="user-profile">
            <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}>
              <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
            </button>
            <div className="notification-icon" style={{ position: 'relative' }} ref={notifMenuRef}>
              <div onClick={() => setShowNotifMenu(!showNotifMenu)} style={{ cursor: 'pointer' }}>
                <i className="fa-regular fa-bell"></i>
                {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
              </div>

              {showNotifMenu && (
                <div className="notif-dropdown" style={{
                  position: 'absolute', top: '100%', right: 0, width: '320px', 
                  backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)',
                  borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', zIindex: 1000, 
                  marginTop: '0.75rem', overflow: 'hidden', display: 'flex', flexDirection: 'column'
                }}>
                  <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                    <span>알림</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--primary-color)', cursor: 'pointer' }} onClick={() => notifications.forEach(n => !n.isRead && markNotificationAsRead(n._id))}>모두 읽음</span>
                  </div>
                  <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>새로운 알림이 없습니다.</div>
                    ) : (
                      notifications.map((notif) => (
                        <div 
                          key={notif._id} 
                          onClick={() => handleNotifClick(notif)}
                          style={{ 
                            padding: '1rem', 
                            borderBottom: '1px solid var(--border-color)', 
                            cursor: 'pointer',
                            backgroundColor: notif.isRead ? 'transparent' : 'rgba(var(--primary-color-rgb), 0.05)',
                            display: 'flex',
                            gap: '0.75rem'
                          }}
                          className="notif-item-hover"
                        >
                          <div style={{ 
                            width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--bg-color)', 
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                          }}>
                            <i className={`fa-solid ${
                              notif.type === 'approval_request' ? 'fa-file-signature' : 
                              notif.type === 'approved' ? 'fa-check-circle' : 
                              notif.type === 'rejected' ? 'fa-times-circle' : 'fa-bell'
                            }`} style={{ 
                              color: notif.type === 'approved' ? 'var(--success)' : 
                                     notif.type === 'rejected' ? 'var(--danger)' : 
                                     notif.type === 'approval_request' ? 'var(--warning)' : 'var(--primary-color)'
                            }}></i>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.875rem', lineHeight: '1.4', marginBottom: '0.25rem', color: 'var(--text-main)', fontWeight: notif.isRead ? 'normal' : '600' }}>
                              {notif.message}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {new Date(notif.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <img src={`https://ui-avatars.com/api/?name=${user?.name || 'User'}&background=0D8ABC&color=fff`} alt="User" />
          </div>
        </header>
        
        {/* Child Pages are rendered here */}
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
