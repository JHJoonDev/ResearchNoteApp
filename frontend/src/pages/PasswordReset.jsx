import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';

export default function PasswordReset() {
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const consumeFragment = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;
      setToken(fragment);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    };
    consumeFragment();
    window.addEventListener('hashchange', consumeFragment);
    return () => window.removeEventListener('hashchange', consumeFragment);
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (token) {
        if (password !== confirm) throw new Error('새 비밀번호가 일치하지 않습니다.');
        await api.post('/auth/password-reset/confirm', { token, newPassword: password });
        setNotice('비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.');
        setPassword('');
        setConfirm('');
      } else {
        await api.post('/auth/password-reset/request', { email });
        setNotice('계정이 존재하면 비밀번호 재설정 안내를 보냈습니다.');
        setEmail('');
      }
    } catch (e) {
      setError(e.message === '새 비밀번호가 일치하지 않습니다.' ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-form">
        <div className="auth-card">
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h1>{token ? '새 비밀번호 설정' : '비밀번호 재설정'}</h1>
          <p className="muted">{token ? '메일로 받은 링크에서 새 비밀번호를 설정합니다.' : '계정이 있는 경우에만 재설정 링크를 전송합니다.'}</p>
          {error && <p role="alert" className="error-banner">{error}</p>}
          {notice && <p role="status" className="notice-banner">{notice}</p>}
          <form onSubmit={submit} className="settings-form">
            {token ? (
              <>
                <label>새 비밀번호 (12자 이상)<input required minLength={12} maxLength={128} type="password" autoComplete="new-password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
                <label>새 비밀번호 확인<input required type="password" autoComplete="new-password" className="form-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
              </>
            ) : (
              <label>이메일<input required type="email" autoComplete="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            )}
            <button className="btn-primary" disabled={busy}>{busy ? '처리 중…' : token ? '비밀번호 변경' : '재설정 링크 요청'}</button>
          </form>
          <Link to="/login" className="view-all">로그인으로 돌아가기</Link>
        </div>
      </section>
    </main>
  );
}
