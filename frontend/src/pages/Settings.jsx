import { PageHeader, Card } from '../components/ui';
import { ShieldCheck, LockKeyhole, Download } from 'lucide-react';
import '../styles/operations.css';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import useAuthStore from '../store/useAuthStore';
import { api, errorMessage, downloadBlob } from '../lib/api';
export default function Settings() {
  const { user, logout } = useAuthStore();
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(null);
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSetup, setMfaSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [mfaError, setMfaError] = useState('');
  const [mfaNotice, setMfaNotice] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    api
      .get('/auth/mfa')
      .then(({ data }) => setMfaEnabled(Boolean(data.enabled)))
      .catch((e) => setMfaError(errorMessage(e)));
  }, []);
  const change = async (e) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    try {
      await api.put('/auth/password', { currentPassword: current, newPassword: next });
      await logout();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportData = async () => {
    setBusy(true);
    setError('');
    try {
      const notes = [];
      let page = 1;
      let total = Infinity;
      while (notes.length < total) {
        const { data } = await api.get('/eln', { params: { page, limit: 100 } });
        const items = Array.isArray(data) ? data : data.items || [];
        notes.push(...items);
        total = Array.isArray(data) ? items.length : data.total || 0;
        if (!items.length) break;
        page += 1;
      }
      const exported = [];
      for (const n of notes) exported.push((await api.get(`/eln/${n.id}/export`)).data);
      downloadBlob(
        { format: 'labhub-notes', schemaVersion: 1, exportedAt: new Date(), notes: exported },
        'labhub-notes.json',
      );
      setNotice(
        '접근 가능한 노트와 이력을 내보냈습니다. 첨부 원본은 노트 상세에서 별도로 다운로드해주세요.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const setupMfa = async (e) => {
    e.preventDefault();
    setMfaBusy(true);
    setMfaError('');
    setMfaNotice('');
    try {
      const { data } = await api.post('/auth/mfa/setup', { password: mfaPassword });
      const qrDataUrl = await QRCode.toDataURL(data.otpauthUrl);
      setMfaSetup({ ...data, qrDataUrl });
      setMfaPassword('');
      setMfaCode('');
    } catch (e) {
      setMfaError(errorMessage(e));
    } finally {
      setMfaBusy(false);
    }
  };
  const enableMfa = async (e) => {
    e.preventDefault();
    setMfaBusy(true);
    setMfaError('');
    try {
      const { data } = await api.post('/auth/mfa/enable', { code: mfaCode.trim() });
      setRecoveryCodes(data.recoveryCodes || []);
      setMfaEnabled(true);
      setMfaSetup(null);
      setMfaCode('');
      setMfaNotice('복구 코드는 이 화면에서 한 번만 표시됩니다. 안전한 곳에 보관하세요.');
    } catch (e) {
      setMfaError(errorMessage(e));
    } finally {
      setMfaBusy(false);
    }
  };
  const disableMfa = async (e) => {
    e.preventDefault();
    setMfaBusy(true);
    setMfaError('');
    try {
      await api.post('/auth/mfa/disable', { password: mfaPassword, code: mfaCode.trim() });
      setMfaEnabled(false);
      setMfaPassword('');
      setMfaCode('');
      setRecoveryCodes([]);
      setMfaNotice('2단계 인증을 해제했습니다.');
    } catch (e) {
      setMfaError(errorMessage(e));
    } finally {
      setMfaBusy(false);
    }
  };
  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setMfaNotice('복구 코드를 복사했습니다.');
    } catch {
      setMfaError('클립보드에 복사하지 못했습니다. 코드를 직접 선택해 복사해주세요.');
    }
  };
  return (
    <div className="dashboard-content operations-page">
      <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '계정 및 데이터' }]} title="계정 및 데이터" description={<>{user.name} · {user.email}</>} />
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice-banner" role="status">
          {notice}
        </p>
      )}
      <div className="project-grid">
        <Card className="card mfa-card">
          <h2><ShieldCheck aria-hidden="true" />2단계 인증</h2>
          <p className="muted">
            {mfaEnabled === null
              ? '인증 설정을 불러오는 중…'
              : mfaEnabled
                ? '로그인과 서명에 인증 앱 코드가 필요합니다.'
                : '인증 앱(TOTP)으로 로그인과 서명을 보호합니다.'}
          </p>
          {mfaError && <p role="alert" className="error-banner">{mfaError}</p>}
          {mfaNotice && <p role="status" className="notice-banner">{mfaNotice}</p>}
          {recoveryCodes.length > 0 ? (
            <div className="recovery-codes">
              <p>복구 코드를 지금 저장하세요. 이 목록은 다시 표시되지 않습니다.</p>
              <pre>{recoveryCodes.join('\n')}</pre>
              <div className="button-row">
                <button className="btn-outline" type="button" onClick={copyRecoveryCodes}>
                  복구 코드 복사
                </button>
                <button className="btn-secondary" type="button" onClick={() => setRecoveryCodes([])}>
                  확인 후 닫기
                </button>
              </div>
            </div>
          ) : mfaEnabled ? (
            <form onSubmit={disableMfa} className="settings-form">
              <label>
                비밀번호
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  className="form-input"
                  value={mfaPassword}
                  onChange={(e) => setMfaPassword(e.target.value)}
                />
              </label>
              <label>
                인증 앱 코드 또는 복구 코드
                <input
                  required
                  autoComplete="one-time-code"
                  className="form-input"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                />
              </label>
              <button className="btn-secondary" disabled={mfaBusy}>
                {mfaBusy ? '처리 중…' : '2단계 인증 해제'}
              </button>
            </form>
          ) : mfaSetup ? (
            <form onSubmit={enableMfa} className="settings-form">
              <img className="mfa-qr" src={mfaSetup.qrDataUrl} alt="인증 앱 등록 QR 코드" />
              <p>QR 코드를 읽지 못하면 인증 앱에 이 키를 직접 입력하세요.</p>
              <code className="hash-value">{mfaSetup.secret}</code>
              <label>
                인증 앱 코드
                <input
                  required
                  autoComplete="one-time-code"
                  className="form-input"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  className="btn-outline"
                  type="button"
                  onClick={() => {
                    setMfaSetup(null);
                    setMfaPassword('');
                    setMfaCode('');
                  }}
                >
                  취소
                </button>
                <button className="btn-primary" disabled={mfaBusy}>
                  {mfaBusy ? '확인 중…' : '2단계 인증 켜기'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={setupMfa} className="settings-form">
              <label>
                현재 비밀번호
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  className="form-input"
                  value={mfaPassword}
                  onChange={(e) => setMfaPassword(e.target.value)}
                />
              </label>
              <button className="btn-primary" disabled={mfaBusy || mfaEnabled === null}>
                {mfaBusy ? '등록 준비 중…' : '2단계 인증 등록'}
              </button>
            </form>
          )}
        </Card>
        <Card className="card">
          <h2><LockKeyhole aria-hidden="true" />비밀번호 변경</h2>
          <p className="muted">변경 후 모든 기기에서 다시 로그인해야 합니다.</p>
          <form onSubmit={change} className="settings-form">
            <label>
              현재 비밀번호
              <input
                required
                type="password"
                autoComplete="current-password"
                className="form-input"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label>
              새 비밀번호 (12자 이상)
              <input
                required
                minLength={12}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                className="form-input"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label>
              새 비밀번호 확인
              <input
                required
                type="password"
                autoComplete="new-password"
                className="form-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <button className="btn-primary" disabled={busy}>
              비밀번호 변경
            </button>
          </form>
        </Card>
        <Card className="card">
          <h2><Download aria-hidden="true" />연구 데이터 내보내기</h2>
          <p className="project-description muted">
            현재 접근 가능한 연구노트, 버전 이력, 검토 기록, 첨부 메타데이터를 JSON 파일로
            보관합니다. 휴지통과 첨부 원본은 포함되지 않습니다.
          </p>
          <button className="btn-primary" disabled={busy} onClick={exportData}>
            {busy ? '처리 중…' : '연구노트 내보내기'}
          </button>
          <hr />
          <h3>데이터 보관</h3>
          <p className="muted">
            노트 삭제는 휴지통으로 이동하며 실험 중 사용한 시약은 자동 반환하지 않습니다. 초안은
            현재 기기에 계정별로 저장됩니다.
          </p>
          <hr />
          <h3>검토 기록 안내</h3>
          <p className="muted">
            승인은 내부 검토 기록입니다. 별도 검증이나 규정 준수 인증을 의미하지 않습니다.
          </p>
        </Card>
      </div>
    </div>
  );
}
