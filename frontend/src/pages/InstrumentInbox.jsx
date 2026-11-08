import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { asList, recordId } from '../lib/phase3';

export default function InstrumentInbox() {
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState([]);
  const [targets, setTargets] = useState({});
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [fileResponse, noteResponse] = await Promise.all([
      api.get('/inbox'), api.get('/eln', { params: { page: 1, limit: 100 } }),
    ]);
    setFiles(asList(fileResponse.data));
    setNotes(asList(noteResponse.data));
  }, []);
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [load]);

  const attach = async (file) => {
    const fileId = recordId(file);
    const note = notes.find((item) => recordId(item) === targets[fileId]);
    if (!note) { setError('첨부할 연구노트를 선택해주세요.'); return; }
    setBusyId(fileId); setError(''); setNotice('');
    try {
      await api.post(`/inbox/${encodeURIComponent(fileId)}/attach`, { noteId: recordId(note), version: note.version });
      await load(); setNotice(`${file.relativePath || '파일'}을 연구노트에 첨부했습니다.`);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusyId(''); }
  };
  const dismiss = async (file) => {
    const fileId = recordId(file);
    if (!window.confirm(`“${file.relativePath || fileId}” 파일을 보관함에서 제외할까요?`)) return;
    setBusyId(fileId); setError(''); setNotice('');
    try { await api.post(`/inbox/${encodeURIComponent(fileId)}/dismiss`); await load(); setNotice('기기 수집 파일을 제외했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusyId(''); }
  };

  return <div className="dashboard-content phase3-page">
    <div className="phase3-heading"><div><p className="eyebrow">INSTRUMENT FILES</p><h1 className="page-title">기기 수집함</h1><p className="muted">업로드된 원본 파일을 기존 권한과 잠금 규칙에 따라 연구노트에 첨부합니다.</p></div><button className="btn-outline" disabled={loading} onClick={() => load().catch((e) => setError(errorMessage(e)))}>새로고침</button></div>
    {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status" className="notice-banner">{notice}</p>}
    <section className="card phase3-card"><h2>수집 파일</h2>{loading ? <p className="empty-state">파일을 불러오는 중…</p> : files.length ? <div className="inbox-list">{files.map((file) => <article className="inbox-row" key={recordId(file)}><div className="inbox-file-meta"><strong>{file.relativePath || '파일 경로 없음'}</strong><small>{file.instrumentId} · {file.capturedAt ? new Date(file.capturedAt).toLocaleString() : '수집 시각 없음'} · {Number(file.size || 0).toLocaleString()} bytes</small><code className="hash-value">SHA-256 {file.sha256}</code><span className={`item-status ${file.status === 'new' ? 'status-progress' : 'status-done'}`}>{file.status}</span>{file.noteId && <small>연구노트 ID: {file.noteId}</small>}</div>{file.status === 'new' && <div className="inbox-actions"><label>첨부할 연구노트<select className="form-input" value={targets[recordId(file)] || ''} onChange={(e) => setTargets({ ...targets, [recordId(file)]: e.target.value })}><option value="">노트 선택</option>{notes.map((note) => <option key={recordId(note)} value={recordId(note)}>{note.title} · v{note.version}</option>)}</select></label><button className="btn-primary" disabled={busyId === recordId(file) || !targets[recordId(file)]} onClick={() => attach(file)}>{busyId === recordId(file) ? '처리 중…' : '노트에 첨부'}</button><button className="btn-secondary" disabled={busyId === recordId(file)} onClick={() => dismiss(file)}>제외</button></div>}</article>)}</div> : <p className="empty-state">수집된 파일이 없습니다.</p>}</section>
  </div>;
}
