import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useAppStore from '../store/useAppStore';
import useAuthStore from '../store/useAuthStore';
import { api } from '../lib/api';
import { formatQuantity } from '../lib/display';
export default function Dashboard() {
  const { elnData, elnTotal, limsData, fetchElnData, fetchLimsData, loading } = useAppStore();
  const { user } = useAuthStore();
  const [pendingTotal, setPendingTotal] = useState(0);
  useEffect(() => {
    fetchElnData();
    fetchLimsData();
    api.get('/eln/review-queue', { params: { page: 1, limit: 1 } }).then(({ data }) => setPendingTotal(data.total || data.items?.length || 0)).catch(() => {});
  }, [fetchElnData, fetchLimsData]);
  const alerts = limsData.filter((i) => i.status !== '양호');
  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LAB OVERVIEW</p>
          <h1 className="page-title">{user.name}님의 연구 공간</h1>
          <p className="muted">진행 중인 실험과 확인할 항목을 한눈에 살펴보세요.</p>
        </div>
        <Link className="btn-primary" to="/eln">
          연구노트 열기 →
        </Link>
      </div>
      <div className="kpi-cards">
        {[
          ['연구노트', elnTotal, '/eln', '▤'],
          ['검토 대기', pendingTotal, '/approvals', '◷'],
          ['시약 확인 필요', alerts.length, '/lims', '⚗'],
        ].map(([title, count, to, icon]) => (
          <Link className="kpi-card" to={to} key={title}>
            <span className="kpi-icon blue">{icon}</span>
            <div className="kpi-info">
              <h3>{title}</h3>
              <p>
                {loading ? '…' : count}
                <small> 건</small>
              </p>
            </div>
          </Link>
        ))}
      </div>
      <div className="grid-sections">
        <section className="card">
          <div className="card-header">
            <h2>최근 연구 기록</h2>
            <Link to="/eln" className="view-all">
              전체 보기 →
            </Link>
          </div>
          {elnData.length ? (
            elnData.slice(0, 5).map((n) => (
              <Link
                className="dashboard-note"
                key={n.id}
                to={`/eln?noteId=${encodeURIComponent(n.id || n._id)}`}
              >
                <span className="note-glyph">▤</span>
                <span>
                  <strong>{n.title}</strong>
                  <small>
                    {n.author} · {n.date} · v{n.version}
                  </small>
                </span>
                <span className="tag">{n.status}</span>
              </Link>
            ))
          ) : (
            <div className="empty-state">
              <h3>첫 기록을 기다리고 있습니다.</h3>
              <p>연구노트에서 기본 실험 템플릿으로 시작하세요.</p>
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-header">
            <h2>시약 확인 목록</h2>
            <Link to="/lims" className="view-all">
              재고 관리 →
            </Link>
          </div>
          {alerts.length ? (
            alerts.slice(0, 5).map((i) => (
              <div className="dashboard-note" key={i.id}>
                <span>
                  <strong>{i.name}</strong>
                  <small>
                    {formatQuantity(i.stockValue)} {i.unit} · {i.location}
                  </small>
                </span>
                <span className="status-pill status-rejected">{i.status}</span>
              </div>
            ))
          ) : (
            <p className="empty-state">등록된 시약 중 재고·유효기간 경고가 없습니다.</p>
          )}
          <p className="muted">
            유효기간과 최소 재고를 기준으로 표시합니다. 실제 보관 상태는 별도로 확인해주세요.
          </p>
        </section>
      </div>
      <section className="card getting-started">
        <h2>연구실 시작 안내</h2>
        <div>
          <Link to="/members">① 연구실 멤버 등록</Link>
          <Link to="/projects">② 프로젝트와 참여 권한 설정</Link>
          <Link to="/eln">③ 실험 기록과 검토 요청</Link>
          <Link to="/settings">④ 연구 데이터 내보내기</Link>
        </div>
      </section>
    </div>
  );
}
