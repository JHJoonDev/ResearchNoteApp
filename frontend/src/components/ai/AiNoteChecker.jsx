import { useState } from 'react';
import { api } from '../../lib/api';
import { aiErrorMessage } from './aiMessages';
import './ai.css';

const severityLabels = { error: '확인 필요', warning: '주의', info: '참고' };

export default function AiNoteChecker({ noteId, onJump }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const check = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.post('/ai/check-note', { noteId });
      setResult(data.result);
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ai-note-check no-print">
      <div className="button-row"><button type="button" className="btn-outline" onClick={check} disabled={busy}>{busy ? '누락 점검 중…' : '누락 점검'}</button><span className="muted">AI 자문이며 편집을 대신하지 않습니다.</span></div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {busy && <p role="status">노트 내용을 점검하는 중…</p>}
      {result && (result.findings?.length ? <ul className="ai-findings">{result.findings.map((finding, index) => <li key={`${finding.blockIndex}-${index}`}><span className={`ai-severity ai-severity-${finding.severity}`}>{severityLabels[finding.severity] || '참고'}</span><span>{finding.message}</span><button type="button" className="btn-small" onClick={() => onJump(finding.blockIndex)}>블록으로 이동</button></li>)}</ul> : <p role="status" className="muted">점검 결과가 없습니다.</p>)}
    </section>
  );
}
