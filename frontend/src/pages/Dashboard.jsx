import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, FileText, FlaskConical, Users, FolderKanban, Download } from 'lucide-react';
import useAppStore from '../store/useAppStore';
import useAuthStore from '../store/useAuthStore';
import { api } from '../lib/api';
import { formatQuantity } from '../lib/display';
import { PageHeader, Card, StatStrip, StatusPill, noteStatusTone, EmptyState } from '../components/ui';
import '../styles/records.css';

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
  const recentlyApproved = elnData.filter((note) => note.status === '승인됨').length;
  const count = (value) => loading ? '…' : value;
  return (
    <div className="dashboard-content records-page">
      <PageHeader breadcrumbs={[{ label: '연구 공간' }]} title={`${user.name}님의 연구 공간`} description="진행 중인 실험과 확인할 항목을 한눈에 살펴보세요." actions={<Link className="btn-primary" to="/eln">연구노트 열기 <ArrowRight size={18} aria-hidden="true" /></Link>} />
      <StatStrip items={[
        { label: '연구노트', value: count(elnTotal), hint: '연구실의 기록' },
        { label: '검토 대기', value: count(pendingTotal), hint: '내가 검토할 노트', tone: 'warning' },
        { label: '최근 승인 기록', value: count(recentlyApproved), hint: '최근 25건 기준', tone: 'success' },
        { label: '시약 확인 필요', value: count(alerts.length), hint: '재고·유효기간', tone: alerts.length ? 'warning' : 'neutral' },
      ]} />
      <div className="records-dashboard-grid">
        <Card title="최근 연구 기록" actions={<Link to="/eln" className="btn-ghost">전체 보기 <ArrowRight size={16} aria-hidden="true" /></Link>}>
          {elnData.length ? <div className="records-table-scroll"><table className="ui-table records-table"><thead><tr><th scope="col">연구노트</th><th scope="col">상태</th></tr></thead><tbody>
            {elnData.slice(0, 5).map((note) => <tr key={note.id || note._id}><td><Link className="ui-cell-title records-title" to={`/eln?noteId=${encodeURIComponent(note.id || note._id)}`}><span className="records-icon-tile"><FileText size={18} aria-hidden="true" /></span><span><strong>{note.title}</strong><small>{note.author} · {note.date} · v{note.version}</small></span></Link></td><td><StatusPill tone={noteStatusTone(note.status)}>{note.status}</StatusPill></td></tr>)}
          </tbody></table></div> : <EmptyState icon={<BookOpen />} title="첫 기록을 기다리고 있습니다." description="연구노트에서 기본 실험 템플릿으로 시작하세요." />}
        </Card>
        <Card title="시약 확인 목록" actions={<Link to="/lims" className="btn-ghost">재고 관리 <ArrowRight size={16} aria-hidden="true" /></Link>}>
          {alerts.length ? <div className="records-alerts">{alerts.slice(0, 5).map((item) => <div className="records-alert-row" key={item.id}><span className="records-icon-tile"><FlaskConical size={18} aria-hidden="true" /></span><span className="records-alert-copy"><strong>{item.name}</strong><small>{formatQuantity(item.stockValue)} {item.unit} · {item.location}</small></span><StatusPill tone="warning">{item.status}</StatusPill></div>)}</div> : <EmptyState icon={<Check />} title="등록된 시약 중 재고·유효기간 경고가 없습니다." />}
          <p className="muted records-footnote">유효기간과 최소 재고를 기준으로 표시합니다. 실제 보관 상태는 별도로 확인해주세요.</p>
        </Card>
      </div>
      <Card title="연구실 시작 안내" className="records-setup">
        <div className="records-checklist">
          <Link to="/members"><Users size={18} aria-hidden="true" /><span>연구실 멤버 등록</span><ArrowRight size={16} aria-hidden="true" /></Link>
          <Link to="/projects"><FolderKanban size={18} aria-hidden="true" /><span>프로젝트와 참여 권한 설정</span><ArrowRight size={16} aria-hidden="true" /></Link>
          <Link to="/eln"><BookOpen size={18} aria-hidden="true" /><span>실험 기록과 검토 요청</span><ArrowRight size={16} aria-hidden="true" /></Link>
          <Link to="/settings"><Download size={18} aria-hidden="true" /><span>연구 데이터 내보내기</span><ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </Card>
    </div>
  );
}
