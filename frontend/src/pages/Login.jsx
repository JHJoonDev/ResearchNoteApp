import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  
  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (email && password) {
      const success = await login(email, password);
      if (success) {
        navigate('/');
      }
    } else {
      alert('이메일과 비밀번호를 입력해주세요.');
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="logo login-logo">
            <i className="fa-solid fa-flask"></i>
            <span>LabHub</span>
          </div>
          <p className="login-slogan">Next Generation Research Environment</p>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="email">이메일 계정</label>
            <input 
              type="email" 
              id="email" 
              placeholder="researcher@labhub.com" 
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">비밀번호</label>
            <input 
              type="password" 
              id="password" 
              placeholder="••••••••" 
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          <div className="form-options">
            <label className="checkbox-container">
              <input type="checkbox" /> 로그인 상태 유지
            </label>
            <a href="#" className="forgot-password">비밀번호 찾기</a>
          </div>

          {error && <div className="error-message" style={{ color: 'var(--danger-color)', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>}

          <button type="submit" className="btn-primary btn-block" disabled={loading}>
            {loading ? '접속 중...' : '시스템 접속하기'}
          </button>
        </form>
        
        <div className="login-footer">
          <p>LabHub v1.0.0 | 보안 연결됨 <i className="fa-solid fa-lock"></i></p>
        </div>
      </div>
    </div>
  );
}

export default Login;
