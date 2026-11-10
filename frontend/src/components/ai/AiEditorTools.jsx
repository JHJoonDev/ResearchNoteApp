import { useMemo, useState } from 'react';
import { SCHEMA_VERSION, docToPlainText, normalizeDoc } from '@labhub/note-format';
import Modal from '../Modal';
import { api } from '../../lib/api';
import { aiErrorMessage } from './aiMessages';
import './ai.css';
import { Sparkles, Table2 } from 'lucide-react';

const supportedMimeTypes = new Set(['image/png', 'image/jpeg', 'application/pdf']);
const textNode = (text) => (text ? [{ type: 'text', text: String(text) }] : undefined);

function tablesToDoc(tables) {
  const content = [];
  for (const table of tables || []) {
    if (table.title?.trim()) content.push({ type: 'heading', attrs: { level: 3 }, content: textNode(table.title) });
    const rows = [];
    if (Array.isArray(table.header) && table.header.length) {
      rows.push({
        type: 'tableRow',
        content: table.header.map((cell) => ({
          type: 'tableHeader',
          content: [{ type: 'paragraph', content: textNode(cell) }],
        })),
      });
    }
    for (const row of table.rows || []) {
      if (!Array.isArray(row)) continue;
      rows.push({
        type: 'tableRow',
        content: row.map((cell) => ({
          type: 'tableCell',
          content: [{ type: 'paragraph', content: textNode(cell) }],
        })),
      });
    }
    if (rows.length) content.push({ type: 'table', content: rows });
  }
  return normalizeDoc({ type: 'doc', schemaVersion: SCHEMA_VERSION, content });
}

function TablePreview({ tables }) {
  return tables.map((table, index) => (
    <section className="ai-table-preview" key={`${table.title || 'table'}-${index}`}>
      {table.title && <h4>{table.title}</h4>}
      <div className="ai-table-scroll">
        <table>
          {table.header?.length > 0 && <thead><tr>{table.header.map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr></thead>}
          <tbody>{(table.rows || []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  ));
}

export default function AiEditorTools({ features, attachments = [], onInsert }) {
  const [dialog, setDialog] = useState('');
  const [memo, setMemo] = useState('');
  const [source, setSource] = useState('text');
  const [text, setText] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [tableResult, setTableResult] = useState(null);
  const availableAttachments = useMemo(() => attachments.filter((file) => supportedMimeTypes.has(file.mimeType)), [attachments]);

  const close = () => {
    if (busy) return;
    setDialog('');
    setError('');
  };

  const createDraft = async () => {
    setBusy(true);
    setError('');
    setDraft(null);
    try {
      const { data } = await api.post('/ai/draft-note', { memo });
      setDraft(data);
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const extractTables = async () => {
    setBusy(true);
    setError('');
    setTableResult(null);
    try {
      const body = source === 'attachment' ? { attachmentId } : { text };
      const { data } = await api.post('/ai/extract-tables', body);
      setTableResult(data);
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const insertDraft = () => {
    if (!draft?.result?.doc || !draft.runId) return;
    onInsert(normalizeDoc(draft.result.doc), draft.runId);
    close();
  };

  const insertTables = () => {
    if (!tableResult?.result?.tables?.length || !tableResult.runId) return;
    onInsert(tablesToDoc(tableResult.result.tables), tableResult.runId);
    close();
  };

  return (
    <section className="ai-tools no-print" aria-label="AI 문서 도구">
      <p className="muted">AI 결과는 제안입니다. 내용을 검토한 뒤 직접 삽입하고 저장하세요.</p>
      <div className="button-row">
        {features.includes('draftNote') && <button type="button" className="btn-outline" onClick={() => { setDialog('draft'); setDraft(null); setError(''); }}><Sparkles aria-hidden="true" />AI 초안</button>}
        {features.includes('extractTables') && <button type="button" className="btn-outline" onClick={() => { setDialog('tables'); setTableResult(null); setError(''); }}><Table2 aria-hidden="true" />표 추출</button>}
      </div>

      {dialog === 'draft' && <Modal title="AI 초안 제안" onClose={close} busy={busy} wide>
        <div>
          <div className="modal-body ai-dialog-body">
            {error && <p role="alert" className="error-banner">{error}</p>}
            <label className="form-group">실험 메모<textarea className="form-input" rows="6" required value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="관찰·조건·결과 등 메모를 입력하세요." /></label>
            <p className="muted">AI 초안이며 검토가 필요합니다. 입력한 연구 데이터는 서버의 AI 설정에 따라 처리됩니다.</p>
            {busy && <p role="status">AI 초안을 만드는 중…</p>}
            {draft && <div className="ai-preview">
              <strong>AI 생성 결과 · 검토 필요</strong>
              {!!draft.result?.missing?.length && <div className="ai-missing-list"><span>확인할 누락 항목</span>{draft.result.missing.map((item, index) => <mark className="ai-missing" key={`${item}-${index}`}>{item}</mark>)}</div>}
              <div className="ai-preview-text">{docToPlainText(draft.result?.doc || {}) || '생성된 내용이 없습니다.'}</div>
            </div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={close} disabled={busy}>닫기</button>
            {draft ? <button type="button" className="btn-primary" onClick={insertDraft}>초안을 문서에 삽입</button> : <button type="button" className="btn-primary" disabled={busy || !memo.trim()} onClick={createDraft}>{busy ? '생성 중…' : '초안 만들기'}</button>}
          </div>
        </div>
      </Modal>}

      {dialog === 'tables' && <Modal title="AI 표 추출" onClose={close} busy={busy} wide>
        <div>
          <div className="modal-body ai-dialog-body">
            {error && <p role="alert" className="error-banner">{error}</p>}
            <div className="button-row" role="group" aria-label="표 추출 원본">
              <button type="button" className={source === 'text' ? 'btn-primary' : 'btn-outline'} onClick={() => setSource('text')}>붙여넣은 텍스트</button>
              <button type="button" className={source === 'attachment' ? 'btn-primary' : 'btn-outline'} disabled={!availableAttachments.length} onClick={() => setSource('attachment')}>노트 첨부 파일</button>
            </div>
            {source === 'text' ? <label className="form-group">표가 포함된 텍스트<textarea className="form-input" rows="7" required value={text} onChange={(event) => setText(event.target.value)} placeholder="표 내용을 붙여넣으세요." /></label> : <label className="form-group">추출할 첨부<select className="form-input" required value={attachmentId} onChange={(event) => setAttachmentId(event.target.value)}><option value="">첨부 파일 선택</option>{availableAttachments.map((file) => <option key={file._id || file.id} value={file._id || file.id}>{file.originalName}</option>)}</select><small className="muted">PNG, JPEG, PDF만 사용할 수 있습니다.</small></label>}
            <p className="muted">추출 결과는 제안입니다. 표를 확인한 뒤 문서에 삽입하세요.</p>
            {busy && <p role="status">표를 추출하는 중…</p>}
            {tableResult && (tableResult.result?.tables?.length ? <div className="ai-preview"><strong>AI 추출 결과 · 검토 필요</strong><TablePreview tables={tableResult.result.tables} /></div> : <p role="status" className="muted">표를 찾지 못했습니다.</p>)}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={close} disabled={busy}>닫기</button>
            {tableResult?.result?.tables?.length ? <button type="button" className="btn-primary" onClick={insertTables}>표를 문서에 삽입</button> : <button type="button" className="btn-primary" disabled={busy || (source === 'text' ? !text.trim() : !attachmentId)} onClick={extractTables}>{busy ? '추출 중…' : '표 추출'}</button>}
          </div>
        </div>
      </Modal>}
    </section>
  );
}
