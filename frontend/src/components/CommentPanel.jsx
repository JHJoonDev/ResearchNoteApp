import { useCallback, useEffect, useMemo, useState } from 'react';
import useAuthStore from '../store/useAuthStore';
import { docToPlainText } from '../lib/noteFormat';
import { api, errorMessage } from '../lib/api';

const commentId = (comment) => comment.id || comment._id;

export default function CommentPanel({ note, doc, canManage }) {
  const { user } = useAuthStore();
  const [comments, setComments] = useState([]);
  const [members, setMembers] = useState([]);
  const [body, setBody] = useState('');
  const [blockIndex, setBlockIndex] = useState('');
  const [mentions, setMentions] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [editing, setEditing] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await api.get(`/eln/${note.id}/comments`);
    setComments(Array.isArray(data) ? data : data.items || []);
  }, [note.id]);
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    api.get('/members').then(({ data }) => setMembers(data.filter((member) => member.isActive !== false))).catch(() => {});
  }, [load]);

  const blocks = useMemo(() => (doc?.content || []).map((node, index) => ({
    index,
    text: docToPlainText({ type: 'doc', content: [node] }).trim().replace(/\s+/g, ' ').slice(0, 100),
  })), [doc]);
  const roots = comments.filter((item) => !item.parentId);
  const replies = (id) => comments.filter((item) => String(item.parentId) === String(id));
  const mayEdit = (item) => String(item.authorId) === user.id;
  const mayDelete = (item) => mayEdit(item) || user.role === 'admin' || canManage;
  const handle = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const postComment = (event) => {
    event.preventDefault();
    handle(async () => {
      await api.post(`/eln/${note.id}/comments`, {
        body: body.trim(),
        parentId: null,
        blockIndex: blockIndex === '' ? null : Number(blockIndex),
        mentions,
      });
      setBody('');
      setBlockIndex('');
      setMentions([]);
    });
  };
  const postReply = (event) => {
    event.preventDefault();
    handle(async () => {
      await api.post(`/eln/${note.id}/comments`, { body: replyBody.trim(), parentId: replyTo, blockIndex: null, mentions: [] });
      setReplyTo(null);
      setReplyBody('');
    });
  };

  return (
    <section className="comment-panel">
      <div className="card-header"><h3>댓글과 토론</h3><span className="muted">{comments.length}개</span></div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {user.role !== 'viewer' && (
        <form className="comment-compose" onSubmit={postComment}>
          <label>댓글<textarea required maxLength={5000} className="form-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="질문이나 의견을 남기세요." /></label>
          <label>본문 위치 (선택)<select className="form-input" value={blockIndex} onChange={(e) => setBlockIndex(e.target.value)}><option value="">전체 댓글</option>{blocks.map((block) => <option key={block.index} value={block.index}>블록 {block.index + 1}: {block.text || '(빈 블록)'}</option>)}</select></label>
          <label>알림할 멤버 (@ 멘션)<select className="form-input" multiple value={mentions} onChange={(e) => setMentions(Array.from(e.target.selectedOptions, (option) => option.value))}>{members.filter((member) => member.id !== user.id).map((member) => <option key={member.id} value={member.id}>@{member.name}</option>)}</select></label>
          <button className="btn-primary" disabled={busy || !body.trim()}>댓글 등록</button>
        </form>
      )}
      {!roots.length ? <p className="muted">아직 댓글이 없습니다.</p> : roots.map((item) => (
        <article className={`comment-thread ${item.resolvedAt ? 'is-resolved' : ''}`} key={commentId(item)}>
          <div className="comment-entry">
            <div className="card-header"><strong>{item.authorName || '멤버'}</strong><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}{item.editedAt ? ' · 수정됨' : ''}</small></div>
            {item.blockIndex !== null && item.blockIndex !== undefined && <p className="comment-anchor">본문 블록 {item.blockIndex + 1}</p>}
            {editing === commentId(item) ? (
              <form onSubmit={(event) => { event.preventDefault(); handle(async () => { await api.put(`/comments/${commentId(item)}`, { body: editBody.trim() }); setEditing(null); }); }}>
                <textarea required className="form-input" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                <div className="button-row"><button className="btn-primary" disabled={busy}>수정 저장</button><button type="button" className="btn-outline" onClick={() => setEditing(null)}>취소</button></div>
              </form>
            ) : <p className="comment-body">{item.body}</p>}
            {!!item.mentions?.length && <small className="muted">멘션: {item.mentions.map((id) => members.find((member) => member.id === String(id))?.name || String(id)).join(', ')}</small>}
            <div className="button-row">
              {user.role !== 'viewer' && <button className="btn-outline" onClick={() => { setReplyTo(commentId(item)); setReplyBody(''); }}>답글</button>}
              {mayEdit(item) && <button className="btn-outline" onClick={() => { setEditing(commentId(item)); setEditBody(item.body); }}>수정</button>}
              {mayDelete(item) && !item.resolvedAt && <button className="btn-outline" onClick={() => handle(() => api.post(`/comments/${commentId(item)}/resolve`, {}))}>해결</button>}
              {mayDelete(item) && <button className="btn-outline" onClick={() => { if (window.confirm('댓글을 삭제할까요?')) handle(() => api.delete(`/comments/${commentId(item)}`)); }}>삭제</button>}
              {item.resolvedAt && <span className="status-pill status-approved">해결됨</span>}
            </div>
          </div>
          {replies(commentId(item)).map((reply) => (
            <article className="comment-reply" key={commentId(reply)}><strong>{reply.authorName || '멤버'}</strong><p>{reply.body}</p><small>{reply.createdAt ? new Date(reply.createdAt).toLocaleString() : ''}</small>{mayDelete(reply) && <button className="btn-outline" onClick={() => { if (window.confirm('답글을 삭제할까요?')) handle(() => api.delete(`/comments/${commentId(reply)}`)); }}>삭제</button>}</article>
          ))}
          {replyTo === commentId(item) && <form className="comment-reply-form" onSubmit={postReply}><label>답글<textarea required className="form-input" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} /></label><div className="button-row"><button className="btn-primary" disabled={busy || !replyBody.trim()}>답글 등록</button><button type="button" className="btn-outline" onClick={() => setReplyTo(null)}>취소</button></div></form>}
        </article>
      ))}
    </section>
  );
}
