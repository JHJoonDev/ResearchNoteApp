import React, { useEffect, useState, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import useAppStore from '../store/useAppStore';
import ProfileModal from './ProfileModal';

function Layout() {
  const navigate = useNavigate();

  const logout = useAuthStore((state) => state.logout);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const { notifications, fetchNotifications, markNotificationAsRead, searchGlobal } = useAppStore();
  const user = useAuthStore((state) => state.user);
  
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  
  const notifMenuRef = useRef(null);
  const searchRef = useRef(null);

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

  // Click outside to close notification and search menus
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifMenuRef.current && !notifMenuRef.current.contains(event.target)) {
        setShowNotifMenu(false);
      }
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSearchResults(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.trim().length >= 2) {
        setIsSearching(true);
        const results = await searchGlobal(searchQuery);
        setSearchResults(results);
        setIsSearching(false);
      } else {
        setSearchResults(null);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, searchGlobal]);

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
          {user?.role === 'admin' && (
            <NavLink to="/audit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <i className="fa-solid fa-clipboard-list"></i> 감사 로그
            </NavLink>
          )}
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
          
          <div className="search-bar" ref={searchRef} style={{ position: 'relative' }}>
            <i className="fa-solid fa-magnifying-glass"></i>
            <input 
              type="text" 
              placeholder="노트 제목, 시약명, 멤버 등 검색..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && <span className="spinner" style={{ width: '15px', height: '15px', marginLeft: '10px' }}></span>}
            
            {searchResults && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
                marginTop: '0.5rem', padding: '1rem', zIndex: 1000, maxHeight: '400px', overflowY: 'auto'
              }}>
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>연구노트</h4>
                  {searchResults.eln.length === 0 ? <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>결과 없음</p> : 
                    searchResults.eln.map(item => (
                      <div key={item._id} onClick={() => { navigate(`/eln/${item._id}`); setSearchResults(null); }} style={{ padding: '0.5rem', cursor: 'pointer', borderRadius: '4px' }} className="notif-item-hover">
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{item.title}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>작성자: {item.author}</div>
                      </div>
                    ))
                  }
                </div>
                
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>시약 관리 (LIMS)</h4>
                  {searchResults.lims.length === 0 ? <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>결과 없음</p> : 
                    searchResults.lims.map(item => (
                      <div key={item._id} onClick={() => { navigate('/lims'); setSearchResults(null); }} style={{ padding: '0.5rem', cursor: 'pointer', borderRadius: '4px' }} className="notif-item-hover">
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{item.name} <span style={{fontSize:'0.8rem', color:'var(--text-muted)'}}>(CAS: {item.cas})</span></div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>재고: {item.stockValue} {item.unit}</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
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
                  borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', zIndex: 1000, 
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
            <img 
              src={`https://ui-avatars.com/api/?name=${user?.name || 'User'}&background=0D8ABC&color=fff`} 
              alt="User" 
              onClick={() => setShowProfileModal(true)}
              style={{ cursor: 'pointer' }}
            />
          </div>
        </header>
        
        {/* Child Pages are rendered here */}
        <Outlet />
      </main>
      
      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
    </div>
  );
}

export default Layout;
