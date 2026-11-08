import React, { useEffect, useState } from 'react';
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

  if (user?.role !== 'admin') {
    return (
      <div className="dashboard-content" style={{ textAlign: 'center', padding: '5rem 2rem' }}>
        <i
          className="fa-solid fa-triangle-exclamation"
          style={{ fontSize: '3rem', color: 'var(--danger)', marginBottom: '1.5rem' }}
        ></i>
        <h2>접근 거부됨</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          감사 로그(Audit Trail)는 관리자(책임 연구원) 계정만 열람할 수 있습니다. 일반 연구원은 개별
          연구노트 상세 화면 내 감사 추적 기능을 사용해 주십시오.
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="card-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.2rem' }}>
            시스템 감사 로그 (Audit Trail)
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            <i className="fa-solid fa-shield-halved"></i> 기록·재고·계정의 변경 이력을 확인합니다.
            검색 결과는 최근 500건까지 표시됩니다.
          </p>
        </div>
        <button className="btn-primary" disabled={verifyBusy} onClick={verifyAuditChain}>
          {verifyBusy ? '체인 검증 중…' : '감사 체인 검증'}
        </button>
      </div>
      {verifyError && <p className="error-banner" role="alert">{verifyError}</p>}
      {verifyResult && (
        <section className="card audit-verification" aria-live="polite">
          <h2>감사 체인 검증 결과</h2>
          <p className={verifyResult.valid ? 'verify-result valid' : 'verify-result invalid'}>
            {verifyResult.valid ? '체인 검증 통과' : '체인 검증 실패'}
          </p>
          <p>체인: {verifyResult.chains?.length ?? '미제공'} · 앵커: {verifyResult.anchors?.length ?? '미제공'}</p>
          {verifyResult.brokenAt?.length > 0 && (
            <details>
              <summary>불일치 위치 {verifyResult.brokenAt.length}건</summary>
              <pre>{JSON.stringify(verifyResult.brokenAt, null, 2)}</pre>
            </details>
          )}
        </section>
      )}

      {/* 필터 바 */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.2rem 1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '150px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: '700' }}>작업 구분</label>
            <select
              className="form-input"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ padding: '0.5rem 0.8rem' }}
            >
              <option value="">전체 작업</option>
              {[
                'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGE', 'MFA_ENABLE', 'MFA_DISABLE',
                'PROJECT_CREATE', 'PROJECT_UPDATE', 'TEMPLATE_CREATE', 'TEMPLATE_UPDATE', 'EXPORT',
                'SEAL', 'TIMESTAMP', 'AMEND', 'USER_DEACTIVATE',
              ].map((event) => (
                <option value={event} key={event}>{eventLabel(event)}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '150px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: '700' }}>대상 리소스</label>
            <select
              className="form-input"
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value)}
              style={{ padding: '0.5rem 0.8rem' }}
            >
              <option value="">전체 리소스</option>
              <option value="ELN">ELN (연구노트)</option>
              <option value="LIMS">LIMS (시약관리)</option>
              <option value="MEMBER">MEMBER (멤버관리)</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-primary"
              onClick={handleApplyFilter}
              style={{ padding: '0.55rem 1.2rem', borderRadius: '8px' }}
            >
              <i className="fa-solid fa-filter"></i> 필터 적용
            </button>
            <button
              className="btn-secondary"
              onClick={handleResetFilter}
              style={{ padding: '0.55rem 1.2rem', borderRadius: '8px' }}
            >
              초기화
            </button>
          </div>
        </div>
      </div>

      {/* 테이블 리스트 */}
      <div className="card">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <span
              className="spinner"
              style={{
                display: 'inline-block',
                width: '1.5rem',
                height: '1.5rem',
                border: '3px solid var(--border-color)',
                borderTopColor: 'var(--primary-color)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            ></span>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>로그 기록일시</th>
                <th>작업 구분</th>
                <th>대상 리소스</th>
                <th>상세 행위</th>
                <th>작업자</th>
                <th>IP 주소</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan="7"
                    style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}
                  >
                    감사 로그 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log._id}>
                    <td style={{ fontSize: '0.85rem' }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <span
                        className="item-status"
                        style={{
                          backgroundColor:
                            log.action === 'CREATE'
                              ? 'rgba(16, 185, 129, 0.1)'
                              : log.action === 'SIGN'
                                ? 'rgba(99, 102, 241, 0.1)'
                                : log.action === 'DELETE'
                                  ? 'rgba(239, 68, 68, 0.1)'
                                  : 'rgba(245, 158, 11, 0.1)',
                          color:
                            log.action === 'CREATE'
                              ? 'var(--success)'
                              : log.action === 'SIGN'
                                ? 'var(--primary-color)'
                                : log.action === 'DELETE'
                                  ? 'var(--danger)'
                                  : 'var(--warning)',
                          fontSize: '0.75rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontWeight: '700',
                        }}
                      >
                        {eventLabel(log.action)}
                      </span>
                    </td>
                    <td style={{ fontWeight: '600' }}>{log.targetType}</td>
                    <td style={{ fontSize: '0.9rem' }}>{log.description}</td>
                    <td>
                      <strong>{log.userName}</strong>
                      <br />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {log.userEmail || 'system'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                      {log.ipAddress || '127.0.0.1'}
                    </td>
                    <td>
                      <button
                        className="btn-icon"
                        onClick={() => handleOpenDetail(log)}
                        title="원시 스냅샷(JSON) 보기"
                      >
                        <i className="fa-solid fa-circle-info"></i>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="pagination" aria-label="감사 로그 페이지">
        <button
          className="btn-outline"
          disabled={loading || auditPage <= 1}
          onClick={() => useAppStore.setState({ auditPage: auditPage - 1 })}
        >
          이전
        </button>
        <span>{auditPage} / {pageCount} · 전체 {auditTotal}건</span>
        <button
          className="btn-outline"
          disabled={loading || auditPage >= pageCount}
          onClick={() => useAppStore.setState({ auditPage: auditPage + 1 })}
        >
          다음
        </button>
      </div>

      {/* 감사 스냅샷 상세 모달 */}
      {isDetailOpen && selectedLog && (
        <div className="modal-overlay">
          <div className="modal-content wide">
            <div className="modal-header">
              <h2>감사 로그 무결성 상세 검증 (Raw Snapshot)</h2>
              <button className="close-btn" onClick={() => setIsDetailOpen(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              <div
                style={{
                  padding: '1rem',
                  background: 'rgba(99, 102, 241, 0.05)',
                  border: '1px solid var(--primary-color)',
                  borderRadius: '12px',
                  marginBottom: '1.5rem',
                  fontSize: '0.85rem',
                }}
              >
                <strong>작업:</strong> {selectedLog.description}
                <br />
                <strong>시점:</strong> {new Date(selectedLog.createdAt).toLocaleString()} |{' '}
                <strong>작업인 ID:</strong> {selectedLog.userId || 'System'}
                <br />
                <strong>타겟 리소스 식별 ID:</strong> {selectedLog.targetId || 'N/A'}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <h4 style={{ marginBottom: '0.5rem' }}>이전 데이터 상태 (Previous State)</h4>
                  <pre
                    style={{
                      padding: '1rem',
                      background: '#0f172a',
                      color: '#38bdf8',
                      borderRadius: '8px',
                      overflowX: 'auto',
                      fontSize: '0.8rem',
                      minHeight: '180px',
                    }}
                  >
                    {selectedLog.previousState
                      ? JSON.stringify(selectedLog.previousState, null, 2)
                      : '// 기록된 이전 상태가 없음 (최초 생성)'}
                  </pre>
                </div>
                <div>
                  <h4 style={{ marginBottom: '0.5rem' }}>변경 후 데이터 상태 (New State)</h4>
                  <pre
                    style={{
                      padding: '1rem',
                      background: '#0f172a',
                      color: '#4ade80',
                      borderRadius: '8px',
                      overflowX: 'auto',
                      fontSize: '0.8rem',
                      minHeight: '180px',
                    }}
                  >
                    {selectedLog.newState
                      ? JSON.stringify(selectedLog.newState, null, 2)
                      : '// 기록된 새 상태가 없음 (삭제 또는 단순 조회/서명)'}
                  </pre>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsDetailOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AuditLogs;
