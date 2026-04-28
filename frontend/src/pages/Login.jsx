import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';

function Login() {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  
  const navigate = useNavigate();
  
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isRegisterMode) {
      if (email && password && name) {
        const result = await register(email, password, name);
        if (result && result.success) {
          alert('가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.');
          setIsRegisterMode(false);
        } else {
          alert(result?.message || '회원가입 중 오류가 발생했습니다.');
        }
      } else {
        alert('모든 필드를 입력해주세요.');
      }
    } else {
      if (email && password) {
        const success = await login(email, password);
        if (success) {
          navigate('/');
        }
      } else {
        alert('이메일과 비밀번호를 입력해주세요.');
      }
    }
  };

  return (
    <div className="login-container" style={{ background: 'var(--bg-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1rem' }}>
      <div className="login-card" style={{ width: '100%', maxWidth: '400px', background: 'var(--surface-color)', borderRadius: '24px', padding: '2.5rem 2rem', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-color)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--text-main)', marginBottom: '0.5rem', letterSpacing: '-0.025em' }}>
            {isRegisterMode ? '새 계정 만들기' : '계정에 로그인'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '500' }}>
            LabHub — AI 업무 자동화 연구 플랫폼
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {isRegisterMode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="name" style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-main)' }}>이름</label>
              <input 
                type="text" 
                id="name" 
                placeholder="홍길동" 
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required={isRegisterMode}
                style={{ padding: '0.875rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '0.95rem' }}
              />
            </div>
          )}

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
              {!isRegisterMode && <a href="#" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'underline' }}>비밀번호를 잊으셨나요?</a>}
            </div>
            <input 
              type="password" 
              id="password" 
              placeholder="••••••••" 
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={{ padding: '0.875rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '0.95rem' }}
            />
          </div>

          {error && <div style={{ color: 'var(--danger)', fontSize: '0.875rem', textAlign: 'center' }}>{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '0.5rem', width: '100%', padding: '0.875rem', borderRadius: '14px', fontSize: '1rem', fontWeight: '700', justifyContent: 'center' }}>
            {loading ? '처리 중...' : (isRegisterMode ? '가입 신청하기' : '로그인')}
          </button>
        </form>
        
        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <button 
            type="button" 
            onClick={() => setIsRegisterMode(!isRegisterMode)} 
            style={{ background: 'none', border: 'none', color: 'var(--primary-color)', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            {isRegisterMode ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
          </button>
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          가입하시면 LabHub의 <a href="#" style={{ textDecoration: 'underline', color: 'var(--text-main)' }}>이용약관</a> 및 <br/>
          <a href="#" style={{ textDecoration: 'underline', color: 'var(--text-main)' }}>개인정보 처리방침</a>에 동의하게 됩니다.
        </div>
      </div>
    </div>
  );
}

export default Login;
