import { useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../Modal';
import { api } from '../../lib/api';
import { aiErrorMessage } from './aiMessages';
import './ai.css';

export default function AiAskDialog({ initialQuestion = '', onClose }) {
  const [question, setQuestion] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState(null);

  const ask = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      const { data } = await api.post('/ai/ask', { question });
      setAnswer(data.result);
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="연구노트에 질문하기" onClose={onClose} busy={busy} wide>
    <form onSubmit={ask}>
      <div className="modal-body ai-dialog-body">
        {error && <p role="alert" className="error-banner">{error}</p>}
        <label className="form-group">질문<textarea className="form-input" rows="3" required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="접근 가능한 연구노트에 관해 질문하세요." /></label>
        <p className="muted">답변은 접근 가능한 연구노트와 인용을 확인해 검토하세요.</p>
        {busy && <p role="status">연구노트를 확인하는 중…</p>}
        {answer && <div className="ai-preview"><strong>AI 답변 · 검토 필요</strong><p className="ai-answer-text">{answer.answer}</p>{answer.warnings?.map((warning, index) => <p className="muted" key={index}>{warning}</p>)}{!!answer.citations?.length && <section className="ai-citations"><h3>인용한 노트</h3>{answer.citations.map((citation, index) => <article key={`${citation.noteId}-${index}`}><Link to={`/eln?noteId=${encodeURIComponent(citation.noteId)}`} onClick={onClose}>{citation.title || '연구노트 열기'}</Link><blockquote>{citation.citedText}</blockquote></article>)}</section>}</div>}
      </div>
      <div className="modal-footer"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>닫기</button><button className="btn-primary" disabled={busy || !question.trim()}>{busy ? '질문 중…' : answer ? '다시 질문' : '질문하기'}</button></div>
    </form>
  </Modal>;
}
