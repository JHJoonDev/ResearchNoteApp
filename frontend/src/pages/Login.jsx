import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import { api, errorMessage } from '../lib/api';
export default function Login() {
  const location = useLocation();
  const { login, completeMfaLogin, isAuthenticated, loading, error: loginError } = useAuthStore();
  const [setup, setSetup] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [authProviders, setAuthProviders] = useState(null);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', setupToken: '' });
  const check = () =>
    api
      .get('/auth/setup')
      .then(({ data }) => {
        setSetup(data.required);
        setError('');
      })
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    check();
    api.get('/auth/providers').then(({ data }) => setAuthProviders(data)).catch(() => setAuthProviders(null));
  }, []);
  if (isAuthenticated) return <Navigate to="/" replace />;
  const oidcEnabled = authProviders?.oidc?.enabled === true;
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (setup) {
        await api.post('/auth/setup', form, { headers: { 'X-Setup-Token': form.setupToken } });
        setSetup(false);
      }
      const result = await login(form.email, form.password);
      if (result?.mfaRequired) {
        setMfaToken(result.mfaToken);
        setMfaCode('');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const submitMfa = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const complete = await completeMfaLogin(mfaToken, mfaCode.trim());
      if (complete) {
        setMfaToken('');
        setMfaCode('');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-story">
        <span className="brand-mark">▤ LabHub</span>
        <h1>
          발견의 순간을
          <br />
          신뢰할 수 있는 기록으로.
        </h1>
        <p>
          실험 노트, 시약, 검토 이력을
          <br />
          연구팀의 한 공간에서 관리하세요.
        </p>
        <div className="auth-features">
          <span>01 · 실험 기록과 템플릿</span>
          <span>02 · 시약 재고와 사용 이력</span>
          <span>03 · 버전 관리와 검토</span>
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-card">
          <p className="eyebrow">YOUR RESEARCH STARTS HERE</p>
          <h2>{mfaToken ? '2단계 인증' : setup ? '연구실 시작하기' : '로그인'}</h2>
          <p className="muted">
            {mfaToken
              ? '인증 앱 코드 또는 복구 코드를 입력하세요.'
              : setup
              ? '첫 관리자 계정을 만듭니다. 예제 데이터는 생성하지 않습니다.'
              : '계정으로 연구 공간에 접속하세요.'}
          </p>
          {location.state?.notice && <p role="status" className="notice-banner">{location.state.notice}</p>}
          {(error || loginError) && (
            <p role="alert" className="error-banner">
              {error || loginError}
            </p>
          )}
          {mfaToken ? (
            <form onSubmit={submitMfa}>
              <label>
                인증 코드 또는 복구 코드
                <input
                  autoFocus
                  required
                  className="form-input"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="btn-secondary" type="button" onClick={() => setMfaToken('')}>
                  로그인으로 돌아가기
                </button>
                <button className="btn-primary" disabled={busy || loading}>
                  {busy || loading ? '확인 중…' : '확인하고 로그인'}
                </button>
              </div>
            </form>
          ) : setup === null ? (
            <button className="btn-secondary" onClick={check}>
              연결 확인 / 다시 시도
            </button>
          ) : (
            <form onSubmit={submit}>
              {setup && (
                <label>
                  이름
                  <input
                    required
                    name="name"
                    className="form-input"
                    value={form.name}
                    onChange={change}
                    autoComplete="name"
                  />
                </label>
              )}
              <label>
                이메일
                <input
                  required
                  name="email"
                  type="email"
                  className="form-input"
                  value={form.email}
                  onChange={change}
                  autoComplete="username"
                />
              </label>
              <label>
                비밀번호
                <input
                  required
                  minLength={setup ? 12 : undefined}
                  maxLength={128}
                  name="password"
                  type="password"
                  className="form-input"
                  value={form.password}
                  onChange={change}
                  autoComplete={setup ? 'new-password' : 'current-password'}
                />
              </label>
              {setup && (
                <>
                  <p className="muted">12자 이상으로 설정해주세요.</p>
                  <label>
                    최초 설정 코드 (운영 서버)
                    <input
                      name="setupToken"
                      type="password"
                      className="form-input"
                      value={form.setupToken}
                      onChange={change}
                    />
                  </label>
                </>
              )}
              <button className="btn-primary" disabled={busy || loading}>
                {busy || loading ? '처리 중…' : setup ? '관리자 계정 만들기' : '연구 공간 열기'}
              </button>
            </form>
          )}
          {!setup && !mfaToken && <Link className="view-all" to="/reset-password">비밀번호를 잊으셨나요?</Link>}
          {!setup && !mfaToken && oidcEnabled && <div className="oidc-login"><a className="btn-outline" href="/api/auth/oidc/start">{authProviders.oidc.label || '기관 계정으로 로그인'}</a><p className="muted">SSO 로그인에는 기관의 MFA가 적용됩니다. 전자서명에는 별도 서명 비밀번호가 필요하며, 없는 경우 초대 또는 비밀번호 재설정 절차에서 설정할 수 있습니다.</p></div>}
        </div>
      </section>
    </main>
  );
}
