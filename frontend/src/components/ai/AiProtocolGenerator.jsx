import { useState } from 'react';
import Modal from '../Modal';
import { api } from '../../lib/api';
import { aiErrorMessage } from './aiMessages';
import './ai.css';

export default function AiProtocolGenerator({ onOpenDraft }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.post('/ai/generate-protocol', { instruction });
      setResult(data.result);
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const openInEditor = () => {
    if (!result) return;
    onOpenDraft(result);
    setOpen(false);
  };

  return <>
    <button type="button" className="btn-outline" onClick={() => { setOpen(true); setResult(null); setError(''); }}>AI 프로토콜 초안</button>
    {open && <Modal title="AI 프로토콜 초안" onClose={() => !busy && setOpen(false)} busy={busy} wide>
      <form onSubmit={generate}>
        <div className="modal-body ai-dialog-body">
          {error && <p role="alert" className="error-banner">{error}</p>}
          <label className="form-group">실험 지시사항<textarea className="form-input" rows="5" required value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="목표, 재료와 주요 단계를 적으세요." /></label>
          <p className="muted">AI 결과는 제안이며 검토가 필요합니다. 저장 전 일반 편집기에서 확인하세요.</p>
          {busy && <p role="status">프로토콜 초안을 만드는 중…</p>}
          {result && <div className="ai-preview"><strong>AI 생성 결과 · 검토 필요</strong><h3>{result.title || '제목 없는 프로토콜'}</h3>{result.steps?.length ? <ol>{result.steps.map((step, index) => <li key={index}><strong>{step.title}</strong><p>{step.instructions}</p></li>)}</ol> : <p className="muted">생성된 단계가 없습니다. 일반 편집기에서 추가할 수 있습니다.</p>}{result.safetyNotes?.length > 0 && <div><h4>안전 유의사항</h4><ul>{result.safetyNotes.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}</div>}
        </div>
        <div className="modal-footer"><button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>닫기</button>{result ? <button type="button" className="btn-primary" onClick={openInEditor}>일반 편집기에서 열기</button> : <button className="btn-primary" disabled={busy || !instruction.trim()}>{busy ? '생성 중…' : '초안 생성'}</button>}</div>
      </form>
    </Modal>}
  </>;
}
