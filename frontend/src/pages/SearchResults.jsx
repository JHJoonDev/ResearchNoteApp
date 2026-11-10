import { lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Pagination from '../components/Pagination';
import { api, errorMessage } from '../lib/api';
import AiStatusContext from '../contexts/AiStatusContext';
import { Search, FileText, Sparkles } from 'lucide-react';
import { PageHeader, Card, EmptyState, StatusPill } from '../components/ui';
import '../styles/records.css';

const AiAskDialog = lazy(() => import('../components/ai/AiAskDialog.jsx'));

export default function SearchResults() {
  const aiStatus = useContext(AiStatusContext);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page') || 1));
  const [data, setData] = useState({ items: [], total: 0, page, limit: 20 });
  const requestKey = `${query}|${page}`;
  const [completedKey, setCompletedKey] = useState('');
  const [error, setError] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const loading = Boolean(query.trim()) && completedKey !== requestKey;

  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      return () => { active = false; };
    }
    api
      .get('/search', { params: { q: query, page, limit: 20 } })
      .then(({ data: response }) => {
        if (!active) return;
        setData(response);
        setError('');
        setCompletedKey(requestKey);
      })
      .catch((e) => {
        if (!active) return;
        setError(errorMessage(e));
        setCompletedKey(requestKey);
      });
    return () => { active = false; };
  }, [query, page, requestKey]);

  const setPage = (next) => setParams({ q: query, page: String(next) });
  return (
    <div className="dashboard-content records-page">
      <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '전체 검색' }]} title="전체 검색" description={`“${query}” 검색 결과`} actions={aiStatus.enabled && aiStatus.features.includes('askNotes') && <button className="btn-outline" onClick={() => setAskOpen(true)}><Sparkles aria-hidden="true" />AI에게 질문하기</button>} />
      {askOpen && aiStatus.enabled && aiStatus.features.includes('askNotes') && <Suspense fallback={<p role="status">AI 질문 도구를 불러오는 중…</p>}><AiAskDialog initialQuestion={query} onClose={() => setAskOpen(false)} /></Suspense>}
      {error && completedKey === requestKey && <p role="alert" className="error-banner">{error}</p>}
      <Card>
        {!query.trim() ? <p className="muted">검색어를 입력해주세요.</p> : loading ? <p role="status">검색 중…</p> : !data.items?.length ? (
          <EmptyState icon={<Search />} title="검색 결과가 없습니다." />
        ) : data.items.map((item) => (
          <article className="search-result" key={`${item.type}:${item.id}`}>
            <StatusPill tone="neutral">{item.type}</StatusPill>
            {item.type === 'note' ? (
              <Link className="records-search-link" to={`/eln?noteId=${encodeURIComponent(item.id)}`}><FileText aria-hidden="true" /><h2>{item.title}</h2></Link>
            ) : <h2>{item.title}</h2>}
            <p>{item.snippet}</p>
          </article>
        ))}
        {data.total > data.limit && (
          <Pagination page={data.page || page} limit={data.limit} total={data.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
