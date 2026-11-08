import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { asList, recordId } from '../lib/phase3';

const scopes = [
  { id: 'notes:read', label: '연구노트 읽기' },
  { id: 'inventory:read', label: '재고 읽기' },
  { id: 'inbox:write', label: '기기 수집함 업로드' },
];

export default function ApiKeys() {
  const [keys, setKeys] = useState([]);
  const [form, setForm] = useState({ name: '', scopes: ['notes:read'], expiresAt: '' });
  const [oneTimeKey, setOneTimeKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/api-keys');
    setKeys(asList(data));
  }, []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const toggleScope = (scope) => setForm((current) => ({ ...current, scopes: current.scopes.includes(scope) ? current.scopes.filter((item) => item !== scope) : [...current.scopes, scope] }));
  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); setOneTimeKey('');
    try {
      const { data } = await api.post('/api-keys', { name: form.name.trim(), scopes: form.scopes, ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}) });
      setOneTimeKey(data.key || '');
      setForm({ name: '', scopes: ['notes:read'], expiresAt: '' });
      await load();
      setNotice('API 키가 생성되었습니다. 전체 키는 지금 한 번만 표시됩니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const revoke = async (key) => {
    if (!window.confirm(`“${key.name}” API 키를 폐기할까요?`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await api.delete(`/api-keys/${encodeURIComponent(recordId(key))}`); await load(); setNotice('API 키를 폐기했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const copyKey = async () => {
    try { await navigator.clipboard.writeText(oneTimeKey); setNotice('키를 클립보드에 복사했습니다.'); }
    catch { setError('클립보드에 복사하지 못했습니다. 키를 직접 복사해주세요.'); }
  };

  return <div className="dashboard-content phase3-page">
    <div className="phase3-heading"><div><p className="eyebrow">PUBLIC API</p><h1 className="page-title">API 키</h1><p className="muted">키는 계정 권한을 넘을 수 없으며 전체 키는 생성 시 한 번만 표시됩니다.</p></div></div>
    {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status" className="notice-banner">{notice}</p>}
    {oneTimeKey && <section className="card phase3-card one-time-secret"><h2>새 API 키 · 지금 복사하세요</h2><p>키 원문은 이 화면을 닫으면 다시 볼 수 없습니다.</p><code>{oneTimeKey}</code><button className="btn-primary" onClick={copyKey}>키 복사</button></section>}
    <section className="card phase3-card"><h2>키 만들기</h2><form className="phase3-form-grid" onSubmit={create}><label>이름<input className="form-input" required maxLength="100" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>만료일 (선택)<input className="form-input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label><fieldset className="phase3-scopes"><legend>권한 범위</legend>{scopes.map((scope) => <label key={scope.id}><input type="checkbox" checked={form.scopes.includes(scope.id)} onChange={() => toggleScope(scope.id)} /> {scope.label} <code>{scope.id}</code></label>)}</fieldset><div className="phase3-form-actions"><button className="btn-primary" disabled={busy || !form.scopes.length}>{busy ? '생성 중…' : 'API 키 생성'}</button></div></form></section>
    <section className="card phase3-card"><h2>내 API 키</h2>{keys.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>이름</th><th>접두사</th><th>권한</th><th>만료일</th><th>최근 사용</th><th>작업</th></tr></thead><tbody>{keys.map((key) => <tr key={recordId(key)}><td>{key.name}</td><td><code>{key.prefix}</code></td><td>{(key.scopes || []).join(', ')}</td><td>{key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : '없음'}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '미사용'}</td><td><button className="btn-danger" disabled={busy} onClick={() => revoke(key)}>폐기</button></td></tr>)}</tbody></table></div> : <p className="empty-state">생성된 API 키가 없습니다.</p>}</section>
  </div>;
}
