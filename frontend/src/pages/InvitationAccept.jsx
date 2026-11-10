import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { BrandMark } from '../components/ui';

export default function InvitationAccept() {
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const inspectionStarted = useRef(false);
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    if (!token) {
      setError('초대 토큰이 없습니다. 초대 메일의 링크를 다시 열어주세요.');
      return;
    }
    if (inspectionStarted.current) return;
    inspectionStarted.current = true;
    api.post('/auth/invitation/inspect', { token })
      .then(({ data }) => setInvite(data))
      .catch((e) => setError(errorMessage(e)));
  }, [token]);
  const accept = async (event) => {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/invitation/accept', { token, newPassword: password });
      navigate('/login', { replace: true, state: { notice: '초대를 수락했습니다. 설정한 비밀번호로 로그인해주세요.' } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setPassword('');
      setConfirm('');
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-form"><div className="auth-card">
        <BrandMark />
        <p className="eyebrow">연구실 초대</p>
        <h1>연구실 초대 수락</h1>
        {error && <p role="alert" className="error-banner">{error}</p>}
        {invite ? <>
          <p>{invite.name}님, 연구실 초대를 받았습니다.</p>
          <p className="muted">{invite.email}</p>
          <form className="settings-form" onSubmit={accept}>
            <label>비밀번호 설정 (12자 이상)<input required minLength={12} maxLength={128} type="password" autoComplete="new-password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <label>비밀번호 확인<input required type="password" autoComplete="new-password" className="form-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
            <button className="btn-primary" disabled={busy}>{busy ? '처리 중…' : '초대 수락'}</button>
          </form>
        </> : !error ? <p role="status">초대 정보를 확인하는 중…</p> : null}
        <Link className="view-all" to="/login">로그인으로 이동</Link>
      </div></section>
    </main>
  );
}
