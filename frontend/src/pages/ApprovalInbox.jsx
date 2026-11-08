import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Pagination from '../components/Pagination';
import { api, errorMessage } from '../lib/api';

export default function ApprovalInbox() {
  const [data, setData] = useState({ items: [], total: 0, page: 1, limit: 25 });
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const load = useCallback(async (requestedPage) => {
    try {
      const { data: response } = await api.get('/eln/review-queue', { params: { page: requestedPage, limit: 25 } });
      setData(response);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => load(page), 0);
    return () => window.clearTimeout(timer);
  }, [load, page]);
  return (
    <div className="dashboard-content">
      <div className="page-heading"><div><p className="eyebrow">APPROVAL INBOX</p><h1 className="page-title">검토함</h1><p className="muted">내가 검토할 수 있는 승인 대기 노트입니다.</p></div></div>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <section className="card">
        {data.items?.length ? data.items.map((note) => (
          <article className="note-row" key={note.id || note._id}>
            <div><strong>{note.title}</strong><small>{note.author} · {note.date} · v{note.version}</small></div>
            <Link className="btn-primary" to={`/eln?noteId=${encodeURIComponent(note.id || note._id)}`}>검토 열기</Link>
          </article>
        )) : <p className="empty-state">검토할 노트가 없습니다.</p>}
        {data.total > data.limit && <Pagination page={data.page || page} limit={data.limit} total={data.total} onPage={setPage} />}
      </section>
    </div>
  );
}
