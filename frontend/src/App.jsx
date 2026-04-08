import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

// Components
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ELN from './pages/ELN';
import ELNEditor from './pages/ELNEditor';
import LIMS from './pages/LIMS';
import Members from './pages/Members';
import Settings from './pages/Settings';

import useAuthStore from './store/useAuthStore';

// 허가된 사용자만 진입 가능하도록 하는 라우트 가드
const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* 보호된 라우트들은 Layout 컨테이너를 공유합니다 */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="eln" element={<ELN />} />
          <Route path="eln/new" element={<ELNEditor />} />
          <Route path="eln/:id" element={<ELNEditor />} />
          <Route path="lims" element={<LIMS />} />
          <Route path="members" element={<Members />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        
        {/* 알 수 없는 경로는 대시보드로 이동 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
