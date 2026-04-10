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
    <div className="login-container" style={{ background: 'var(--bg-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="login-card" style={{ width: '100%', maxWidth: '400px', background: 'var(--surface-color)', borderRadius: '24px', padding: '2.5rem 2rem', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-color)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--text-main)', marginBottom: '0.5rem', letterSpacing: '-0.025em' }}>
            계정에 로그인
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '500' }}>
            LabHub — AI 업무 자동화 연구 플랫폼
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label htmlFor="email" style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-main)' }}>이메일</label>
            <input 
              type="email" 
              id="email" 
              placeholder="name@example.com" 
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ padding: '0.875rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '0.95rem' }}
            />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="password" style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-main)' }}>비밀번호</label>
              <a href="#" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'underline' }}>비밀번호를 잊으셨나요?</a>
            </div>
            <input 
              type="password" 
              id="password" 
              placeholder="••••••••" 
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ padding: '0.875rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '0.95rem' }}
            />
          </div>

          {error && <div style={{ color: 'var(--danger)', fontSize: '0.875rem', textAlign: 'center' }}>{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '0.5rem', width: '100%', padding: '0.875rem', borderRadius: '14px', fontSize: '1rem', fontWeight: '700' }}>
            {loading ? '접속 중...' : '로그인'}
          </button>
        </form>
        
        <div style={{ marginTop: '2.5rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          가입하시면 LabHub의 <a href="#" style={{ underline: 'always', color: 'var(--text-main)' }}>이용약관</a> 및 <br/>
          <a href="#" style={{ underline: 'always', color: 'var(--text-main)' }}>개인정보 처리방침</a>에 동의하게 됩니다.
        </div>
      </div>
    </div>
  );
}

export default Login;
