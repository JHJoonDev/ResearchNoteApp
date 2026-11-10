import { useEffect, useState } from 'react';
import { Filter, Info, ShieldAlert, ShieldCheck } from 'lucide-react';
import { PageHeader, Card, Callout, StatusPill, EmptyState } from '../components/ui';
import Modal from '../components/Modal';
import '../styles/operations.css';
import { api, errorMessage } from '../lib/api';
import useAppStore from '../store/useAppStore';
import useAuthStore from '../store/useAuthStore';

const EVENT_LABELS = {
  LOGIN: '로그인',
  LOGIN_FAILED: '로그인 실패',
  LOGOUT: '로그아웃',
  PASSWORD_CHANGE: '비밀번호 변경',
  MFA_ENABLE: '2단계 인증 등록',
  MFA_DISABLE: '2단계 인증 해제',
  EXPORT: '내보내기',
  SEAL: '노트 봉인',
  TIMESTAMP: '시점인증',
  AMEND: '승인 후 정정',
  USER_DEACTIVATE: '계정 비활성화',
};
const eventLabel = (action) =>
  EVENT_LABELS[action] ||
  (action?.startsWith('PROJECT_') ? '프로젝트 변경' : action?.startsWith('TEMPLATE_') ? '템플릿 변경' : action);

function AuditLogs() {
  const { auditLogs, auditTotal, auditPage, auditLimit, loading, fetchAuditLogs } = useAppStore();
  const { user } = useAuthStore();

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({});
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);

  useEffect(() => {
    fetchAuditLogs({ page: auditPage, limit: 25, ...appliedFilters });
  }, [auditPage, appliedFilters, fetchAuditLogs]);

  const handleApplyFilter = () => {
    const filters = {};
    if (actionFilter) filters.action = actionFilter;
    if (targetFilter) filters.targetType = targetFilter;
    setAppliedFilters(filters);
    useAppStore.setState({ auditPage: 1 });
  };

  const handleResetFilter = () => {
    setActionFilter('');
    setTargetFilter('');
    setAppliedFilters({});
    useAppStore.setState({ auditPage: 1 });
  };

  const verifyAuditChain = async () => {
    setVerifyBusy(true);
    setVerifyError('');
    try {
      const { data } = await api.get('/audit/verify');
      setVerifyResult(data);
    } catch (e) {
      setVerifyError(errorMessage(e));
    } finally {
      setVerifyBusy(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(auditTotal / Math.max(auditLimit, 1)));

  const handleOpenDetail = (log) => {
    setSelectedLog(log);
    setIsDetailOpen(true);
  };

  if (user?.role !== 'admin') return <div className="dashboard-content operations-page"><Callout tone="warning" icon={<ShieldAlert />} title="접근 거부됨"><p>감사 로그(Audit Trail)는 관리자(책임 연구원) 계정만 열람할 수 있습니다. 일반 연구원은 개별 연구노트 상세 화면 내 감사 추적 기능을 사용해 주십시오.</p></Callout></div>;

  return (
    <div className="dashboard-content operations-page operations-audit">
      <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '연구실' }, { label: '감사 로그' }]} title="시스템 감사 로그 (Audit Trail)" description="기록·재고·계정의 변경 이력을 확인합니다. 검색 결과는 최근 500건까지 표시됩니다." actions={<button className="btn-primary" disabled={verifyBusy} onClick={verifyAuditChain}><ShieldCheck aria-hidden="true" />{verifyBusy ? '체인 검증 중…' : '감사 체인 검증'}</button>} />
      {verifyError && <p className="error-banner" role="alert">{verifyError}</p>}
      {verifyResult && <Callout className="audit-verification" tone={verifyResult.valid ? 'success' : 'danger'} title="감사 체인 검증 결과" aria-live="polite">
        <p className={verifyResult.valid ? 'verify-result valid' : 'verify-result invalid'}>{verifyResult.valid ? '체인 검증 통과' : '체인 검증 실패'}</p>
        <p>체인: {verifyResult.chains?.length ?? '미제공'} · 앵커: {verifyResult.anchors?.length ?? '미제공'}</p>
        {verifyResult.brokenAt?.length > 0 && <details><summary>불일치 위치 {verifyResult.brokenAt.length}건</summary><pre>{JSON.stringify(verifyResult.brokenAt, null, 2)}</pre></details>}
      </Callout>}
      <Card className="card operations-audit-filters">
        <div className="phase3-toolbar">
          <label className="form-group">작업 구분<select className="form-input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">전체 작업</option>
            {['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGE', 'MFA_ENABLE', 'MFA_DISABLE', 'PROJECT_CREATE', 'PROJECT_UPDATE', 'TEMPLATE_CREATE', 'TEMPLATE_UPDATE', 'EXPORT', 'SEAL', 'TIMESTAMP', 'AMEND', 'USER_DEACTIVATE'].map((event) => <option value={event} key={event}>{eventLabel(event)}</option>)}
          </select></label>
          <label className="form-group">대상 리소스<select className="form-input" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
            <option value="">전체 리소스</option><option value="ELN">ELN (연구노트)</option><option value="LIMS">LIMS (시약관리)</option><option value="MEMBER">MEMBER (멤버관리)</option>
          </select></label>
          <div className="phase3-row-actions"><button className="btn-primary" onClick={handleApplyFilter}><Filter aria-hidden="true" />필터 적용</button><button className="btn-outline" onClick={handleResetFilter}>초기화</button></div>
        </div>
      </Card>
      <Card className="card" padded={false}>
        {loading ? <p className="empty-state" role="status">불러오는 중…</p> : <div className="table-scroll"><table className="data-table ui-table"><thead><tr><th>로그 기록일시</th><th>작업 구분</th><th>대상 리소스</th><th>상세 행위</th><th>작업자</th><th>IP 주소</th><th>작업</th></tr></thead>
          <tbody>{auditLogs.length === 0 ? <tr><td colSpan="7"><EmptyState icon={<ShieldCheck aria-hidden="true" />} title="감사 로그 기록이 없습니다." /></td></tr> : auditLogs.map((log) => <tr key={log._id}>
            <td className="operations-mono">{new Date(log.createdAt).toLocaleString()}</td>
            <td><StatusPill tone={['DELETE', 'LOGIN_FAILED', 'USER_DEACTIVATE'].includes(log.action) ? 'danger' : ['CREATE', 'SIGN', 'SEAL'].includes(log.action) ? 'success' : 'neutral'}>{eventLabel(log.action)}</StatusPill></td>
            <td>{log.targetType}</td><td>{log.description}</td>
            <td><div className="operations-cell-copy"><strong>{log.userName}</strong><small>{log.userEmail || 'system'}</small></div></td><td className="operations-mono">{log.ipAddress || '127.0.0.1'}</td>
            <td><button className="btn-ghost" aria-label="원시 스냅샷(JSON) 보기" title="원시 스냅샷(JSON) 보기" onClick={() => handleOpenDetail(log)}><Info aria-hidden="true" /></button></td>
          </tr>)}</tbody>
        </table></div>}
      </Card>
      <div className="pagination" aria-label="감사 로그 페이지"><button className="btn-outline" disabled={loading || auditPage <= 1} onClick={() => useAppStore.setState({ auditPage: auditPage - 1 })}>이전</button><span>{auditPage} / {pageCount} · 전체 {auditTotal}건</span><button className="btn-outline" disabled={loading || auditPage >= pageCount} onClick={() => useAppStore.setState({ auditPage: auditPage + 1 })}>다음</button></div>
      {isDetailOpen && selectedLog && <Modal title="감사 로그 무결성 상세 검증 (Raw Snapshot)" wide onClose={() => setIsDetailOpen(false)}>
        <div className="modal-body operations-audit-detail"><Callout tone="info" title={selectedLog.description}>
          <p><strong>작업:</strong> {selectedLog.description}</p><p><strong>시점:</strong> {new Date(selectedLog.createdAt).toLocaleString()} | <strong>작업인 ID:</strong> {selectedLog.userId || 'System'}</p><p><strong>타겟 리소스 식별 ID:</strong> {selectedLog.targetId || 'N/A'}</p>
        </Callout><div className="operations-snapshots">
          <div><h4>이전 데이터 상태 (Previous State)</h4><pre>{selectedLog.previousState ? JSON.stringify(selectedLog.previousState, null, 2) : '// 기록된 이전 상태가 없음 (최초 생성)'}</pre></div>
          <div><h4>변경 후 데이터 상태 (New State)</h4><pre>{selectedLog.newState ? JSON.stringify(selectedLog.newState, null, 2) : '// 기록된 새 상태가 없음 (삭제 또는 단순 조회/서명)'}</pre></div>
        </div></div><div className="modal-footer"><button className="btn-outline" onClick={() => setIsDetailOpen(false)}>닫기</button></div>
      </Modal>}
    </div>
  );
}

export default AuditLogs;
