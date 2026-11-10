import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { diffDocs, docToPlainText, noteDoc } from '../lib/noteFormat';
import { api, errorMessage } from '../lib/api';
import { ArrowRight } from 'lucide-react';
import { Callout } from './ui';

function blockText(block) {
  return block ? docToPlainText({ type: 'doc', content: [block] }).trim() : '';
}

export default function VersionHistory({ note, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [source, setSource] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/eln/${note.id}/versions`).then(({ data }) => setVersions(Array.isArray(data) ? data : data.items || [])).catch((e) => setError(errorMessage(e)));
  }, [note.id]);
  const diffs = useMemo(() => source ? diffDocs(noteDoc(source), noteDoc(note)) : [], [source, note]);
  const restore = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/eln/${note.id}/restore-version`, { fromVersion: source.version, version: note.version, reason: reason.trim() });
      await onRestored(data);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const oldDoc = source ? noteDoc(source) : null;
  const newDoc = noteDoc(note);
  return (
    <Modal title="버전 비교 및 복원" wide busy={busy} onClose={onClose}>
      <div className="modal-body version-history">
        {error && <p role="alert" className="error-banner">{error}</p>}
        <Callout tone="info">변경 이력은 과거 상태를 표시하며, 복원은 새 버전을 만듭니다.</Callout>
        <div className="version-list">{versions.map((version) => <button type="button" className={`version-item ${source?.version === version.version ? 'active' : ''}`} key={version.id || version._id || version.version} onClick={async () => { try { const { data } = await api.get(`/eln/${note.id}/versions/${version.version}`); setSource(data); } catch (e) { setError(errorMessage(e)); } }}><strong>v{version.version}</strong><span>{version.changeReason || '변경 사유 없음'}</span><small>{version.updaterName || ''} · {version.createdAt ? new Date(version.createdAt).toLocaleString() : ''}</small></button>)}</div>
        {source && <>
          <h3 className="records-version-title">v{source.version} <ArrowRight aria-hidden="true" /> 현재 v{note.version}</h3>
          <div className="doc-diff">{diffs.map((diff, index) => {
            const oldText = blockText(oldDoc.content?.[diff.blockIndexA]);
            const newText = blockText(newDoc.content?.[diff.blockIndexB]);
            if (diff.op === 'same') return <p className="diff-same" key={index}>{newText || '(빈 블록)'}</p>;
            if (diff.op === 'remove') return <p className="diff-remove" key={index}>− {oldText || '(빈 블록)'}</p>;
            if (diff.op === 'add') return <p className="diff-add" key={index}>＋ {newText || '(빈 블록)'}</p>;
            return <p className="diff-change" key={index}>{diff.inline?.map((part, partIndex) => part.op === 'same' ? <span key={partIndex}>{part.text}</span> : part.op === 'remove' ? <del key={partIndex}>{part.text}</del> : <ins key={partIndex}>{part.text}</ins>)}</p>;
          })}</div>
          {['진행중', '반려'].includes(note.status) && <>
            <label>복원 사유<textarea required minLength={1} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="button" className="btn-secondary" disabled={busy || !reason.trim()} onClick={restore}>이 버전을 새 버전으로 복원</button>
          </>}
        </>}
      </div>
    </Modal>
  );
}
