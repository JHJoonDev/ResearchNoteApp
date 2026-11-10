import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Pagination from '../components/Pagination';
import { api, errorMessage } from '../lib/api';
import { FileCheck, FileText, ArrowRight } from 'lucide-react';
import { PageHeader, Card, StatusPill, EmptyState } from '../components/ui';
import '../styles/records.css';

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
    <div className="dashboard-content records-page">
      <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '검토함' }]} title="검토함" description="내가 검토할 수 있는 승인 대기 노트입니다." />
      {error && <p role="alert" className="error-banner">{error}</p>}
      <Card title={`검토 대기 · ${data.total}`}>
        {data.items?.length ? <div className="records-table-scroll"><table className="ui-table records-table records-review-table"><thead><tr><th scope="col">연구노트</th><th scope="col">상태</th><th scope="col">검토</th></tr></thead><tbody>{data.items.map((note) => (
          <tr key={note.id || note._id}>
            <td><div className="ui-cell-title records-title"><span className="records-icon-tile"><FileText aria-hidden="true" /></span><span><strong>{note.title}</strong><small>{note.author} · {note.date} · v{note.version}</small></span></div></td>
            <td><StatusPill tone="warning">{note.status || '승인대기'}</StatusPill></td>
            <td><Link className="btn-ghost" to={`/eln?noteId=${encodeURIComponent(note.id || note._id)}`}>검토 열기 <ArrowRight size={16} aria-hidden="true" /></Link></td>
          </tr>
        ))}</tbody></table></div> : <EmptyState icon={<FileCheck />} title="검토할 노트가 없습니다." />}
        {data.total > data.limit && <Pagination page={data.page || page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
