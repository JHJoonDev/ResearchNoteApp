import { useCallback, useEffect, useState } from 'react';
import useAuthStore from '../store/useAuthStore';
import { api, errorMessage } from '../lib/api';
import { asList, recordId } from '../lib/phase3';

const eventOptions = ['note.approved', 'note.rejected', 'reagent.low_stock', 'inbox.received'];
const emptyForm = () => ({ url: '', events: ['note.approved'], active: true });

export default function Webhooks() {
  const { user } = useAuthStore();
  const [webhooks, setWebhooks] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryTotal, setDeliveryTotal] = useState(0);
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    const { data } = await api.get('/webhooks');
    setWebhooks(asList(data));
  }, []);
  useEffect(() => { if (isAdmin) load().catch((e) => setError(errorMessage(e))); }, [isAdmin, load]);

  const loadDeliveries = async (hook, page = 1) => {
    if (!hook) return;
    const { data } = await api.get(`/webhooks/${encodeURIComponent(recordId(hook))}/deliveries`, { params: { page, limit: 20 } });
    setDeliveries(asList(data));
    setDeliveryPage(Number(data.page || page));
    setDeliveryTotal(Number(data.total || 0));
  };

  const toggleEvent = (eventName) => setForm((current) => ({ ...current, events: current.events.includes(eventName) ? current.events.filter((event) => event !== eventName) : [...current.events, eventName] }));
  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); setOneTimeSecret('');
    try {
      const { data } = await api.post('/webhooks', { url: form.url.trim(), events: form.events, active: form.active });
      setOneTimeSecret(data.secret || ''); setForm(emptyForm()); await load();
      setNotice('웹훅을 등록했습니다. 서명 비밀값은 지금 한 번만 표시됩니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const toggleActive = async (hook) => {
    setBusy(true); setError(''); setNotice('');
    try { await api.put(`/webhooks/${encodeURIComponent(recordId(hook))}`, { url: hook.url, events: hook.events, active: !hook.active }); await load(); setNotice(hook.active ? '웹훅을 중지했습니다.' : '웹훅을 활성화했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const rotate = async (hook) => {
    setBusy(true); setError(''); setNotice(''); setOneTimeSecret('');
    try { const { data } = await api.post(`/webhooks/${encodeURIComponent(recordId(hook))}/rotate-secret`); setOneTimeSecret(data.secret || ''); setSelected(hook); setNotice('서명 비밀값을 갱신했습니다. 새 값은 지금 한 번만 표시됩니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async (hook) => {
    if (!window.confirm(`“${hook.url}” 웹훅을 삭제할까요?`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await api.delete(`/webhooks/${encodeURIComponent(recordId(hook))}`); if (recordId(selected) === recordId(hook)) { setSelected(null); setDeliveries([]); } await load(); setNotice('웹훅을 삭제했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const revealDeliveries = async (hook) => {
    setSelected(hook); setError('');
    try { await loadDeliveries(hook); } catch (e) { setError(errorMessage(e)); }
  };

  if (!isAdmin) return <div className="dashboard-content phase3-page"><h1 className="page-title">웹훅 관리</h1><p role="alert" className="error-banner">관리자 권한이 필요합니다.</p></div>;
  return <div className="dashboard-content phase3-page">
    <div className="phase3-heading"><div><p className="eyebrow">INTEGRATIONS</p><h1 className="page-title">웹훅 관리</h1><p className="muted">전달 요청에는 HMAC-SHA256 서명이 포함됩니다. 서버가 HTTPS 주소와 전달 대상을 검증합니다.</p></div></div>
    {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status" className="notice-banner">{notice}</p>}
    {oneTimeSecret && <section className="card phase3-card one-time-secret"><h2>서명 비밀값 · 지금 복사하세요</h2><p>이 값은 다시 조회할 수 없습니다. 수신 서버에 안전하게 보관하세요.</p><code>{oneTimeSecret}</code><button className="btn-outline" onClick={() => navigator.clipboard.writeText(oneTimeSecret).then(() => setNotice('비밀값을 복사했습니다.')).catch(() => setError('복사하지 못했습니다. 직접 복사해주세요.'))}>비밀값 복사</button></section>}
    <section className="card phase3-card"><h2>웹훅 등록</h2><form className="phase3-form-grid" onSubmit={create}><label>HTTPS URL<input className="form-input" type="url" required placeholder="https://example.org/hooks/labhub" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label><fieldset className="phase3-scopes"><legend>이벤트</legend>{eventOptions.map((eventName) => <label key={eventName}><input type="checkbox" checked={form.events.includes(eventName)} onChange={() => toggleEvent(eventName)} /> <code>{eventName}</code></label>)}</fieldset><label className="checkbox-inline"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> 등록 후 활성화</label><div className="phase3-form-actions"><button className="btn-primary" disabled={busy || !form.events.length}>웹훅 등록</button></div></form></section>
    <section className="card phase3-card"><h2>등록된 웹훅</h2>{webhooks.length ? webhooks.map((hook) => <article className="webhook-row" key={recordId(hook)}><div><strong>{hook.url}</strong><small>{(hook.events || []).join(', ')}</small></div><span className={`item-status ${hook.active ? 'status-done' : 'status-progress'}`}>{hook.active ? '활성' : '중지'}</span><div className="phase3-row-actions"><button className="btn-small" onClick={() => revealDeliveries(hook)}>전달 기록</button><button className="btn-small" disabled={busy} onClick={() => toggleActive(hook)}>{hook.active ? '중지' : '활성화'}</button><button className="btn-small" disabled={busy} onClick={() => rotate(hook)}>비밀값 갱신</button><button className="btn-danger" disabled={busy} onClick={() => remove(hook)}>삭제</button></div></article>) : <p className="empty-state">등록된 웹훅이 없습니다.</p>}</section>
    {selected && <section className="card phase3-card"><div className="card-header"><h2>전달 기록 · {selected.url}</h2><span className="muted">{deliveryTotal}건</span></div>{deliveries.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>생성 시각</th><th>이벤트</th><th>상태</th><th>시도</th><th>응답</th><th>오류</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={recordId(delivery)}><td>{new Date(delivery.createdAt).toLocaleString()}</td><td><code>{delivery.event}</code></td><td>{delivery.status}</td><td>{delivery.attempts}</td><td>{delivery.responseStatus || '—'}</td><td>{delivery.lastError || '—'}</td></tr>)}</tbody></table></div> : <p className="empty-state">전달 기록이 없습니다.</p>}<div className="phase3-pagination"><button className="btn-small" disabled={deliveryPage <= 1} onClick={() => loadDeliveries(selected, deliveryPage - 1).catch((e) => setError(errorMessage(e)))}>이전</button><span>{deliveryPage} / {Math.max(1, Math.ceil(deliveryTotal / 20))}</span><button className="btn-small" disabled={deliveryPage * 20 >= deliveryTotal} onClick={() => loadDeliveries(selected, deliveryPage + 1).catch((e) => setError(errorMessage(e)))}>다음</button></div></section>}
  </div>;
}
