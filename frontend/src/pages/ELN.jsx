import React, { useEffect, useState } from 'react';
import useAppStore from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import useAuthStore from '../store/useAuthStore';
import SignatureCanvas from 'react-signature-canvas';
import { useRef } from 'react';

function ELN() {
  const navigate = useNavigate();
  const { elnData, loading, fetchElnData, deleteElnNote, updateElnStatus } = useAppStore();
  const user = useAuthStore(state => state.user);
  
  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('');
  
  // Tab state
  const [activeTab, setActiveTab] = useState('notes');

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchElnData(searchTerm);
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, fetchElnData]);



  const handleEdit = (id) => {
    navigate(`/eln/${id}`);
  };

  const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: '', id: null, message: '', targetStatus: '' });
  const sigCanvas = useRef(null);

  const handleApproveClick = (note, e) => {
    e.stopPropagation();
    
    // 권한 검사
    if (note.status === '진행중' && user?.elnRole !== '책임연구원') {
      toast.error('1차 승인 권한이 없습니다. (요구 권한: 책임연구원)');
      return;
    }
    
    if (note.status === '1차 승인' && user?.elnRole !== '연구소장') {
      toast.error('최종 승인 권한이 없습니다. (요구 권한: 연구소장)');
      return;
    }
    
    // 중복 승인 방지
    if (note.status === '1차 승인' && note.approvals && note.approvals.length > 0) {
      if (note.approvals[0].name === user?.name) {
        toast.error('이미 1차 승인을 완료하셨습니다. 다른 작업자가 최종 승인해야 합니다.');
        return;
      }
    }

    const targetStatus = note.status === '진행중' ? '1차 승인' : '승인됨';
    const message = targetStatus === '1차 승인' 
      ? '이 연구노트를 1차 승인하시겠습니까?' 
      : '이 연구노트를 최종 승인하시겠습니까?\n최종 승인 시 시약 재고가 차감됩니다.';

    setConfirmModal({
      isOpen: true,
      type: 'approve',
      id: note.id,
      message,
      targetStatus
    });
  };

  const handleReject = (id, e) => {
    e.stopPropagation();
    setConfirmModal({
      isOpen: true,
      type: 'reject',
      id,
      message: '이 연구노트를 반려하시겠습니까?'
    });
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    setConfirmModal({
      isOpen: true,
      type: 'delete',
      id,
      message: '정말 이 노트를 삭제하시겠습니까?'
    });
  };

  const handleConfirmAction = async () => {
    const { type, id, targetStatus } = confirmModal;
    let signature = null;
    
    if (type === 'approve') {
      if (sigCanvas.current && sigCanvas.current.isEmpty()) {
        toast.error('전자 서명이 필요합니다.');
        return;
      }
      if (sigCanvas.current) {
        signature = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png');
      }
    }

    setConfirmModal({ isOpen: false, type: '', id: null, message: '', targetStatus: '' });
    
    if (type === 'approve') {
      await updateElnStatus(id, targetStatus, user?.name, signature);
    } else if (type === 'reject') {
      await updateElnStatus(id, '반려');
    } else if (type === 'delete') {
      await deleteElnNote(id);
    }
    fetchElnData();
  };

  const [templateModal, setTemplateModal] = useState({ isOpen: false });
  const [renameModal, setRenameModal] = useState({ isOpen: false, oldName: '', newName: '' });

  const templates = elnData.filter(note => note.isTemplate);

  // Get all unique tags for filter
  const allTags = Array.from(new Set(elnData.flatMap(note => note.tags || [])));

  const filteredData = elnData.filter(note => {
    if (note.isTemplate) return false;
    const matchesSearch = note.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          note.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (note.project && note.project.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          (note.content && note.content.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          (note.tags && note.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())));
    const matchesStatus = statusFilter === 'all' || note.status === statusFilter;
    const matchesProject = projectFilter === 'all' || note.project === projectFilter;
    const matchesTag = tagFilter === '' || (note.tags && note.tags.includes(tagFilter));
    return matchesSearch && matchesStatus && matchesProject && matchesTag;
  });

  const handleCreateNew = () => {
    if (templates.length > 0) {
      setTemplateModal({ isOpen: true });
    } else {
      navigate('/eln/new');
    }
  };

  const startFromTemplate = (templateId) => {
    navigate(`/eln/new?templateId=${templateId}`);
  };

  const handleExportCSV = () => {
    if (elnData.length === 0) return toast.error('내보낼 데이터가 없습니다.');
    const headers = ['노트 제목', '작성자', '작성일', '상태', '태그'];
    const csvContent = [
      headers.join(','),
      ...elnData.map(note => [
        `"${note.title.replace(/"/g, '""')}"`, 
        `"${note.author}"`, 
        note.date, 
        note.status, 
        `"${(note.tags || []).join(', ')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ELN_연구노트_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRenameProject = (oldName) => {
    if (user?.role !== 'admin') {
      toast.error('관리자 권한이 필요합니다.');
      return;
    }
    setRenameModal({ isOpen: true, oldName, newName: oldName });
  };

  const executeRenameProject = async () => {
    const { oldName, newName } = renameModal;
    if (!newName || newName.trim() === '' || newName === oldName) {
      setRenameModal({ isOpen: false, oldName: '', newName: '' });
      return;
    }

    try {
      const { default: api } = await import('../api/axios');
      const res = await api.put('/eln/project/rename', { oldName, newName });
      if (res.data.success) {
        toast.success(`프로젝트 이름이 변경되었습니다. (${res.data.modifiedCount}건 적용)`);
        fetchElnData(searchTerm);
      }
    } catch (e) {
      toast.error(e.response?.data?.message || '프로젝트 이름 변경 중 오류가 발생했습니다.');
    }
    setRenameModal({ isOpen: false, oldName: '', newName: '' });
  };

  const uniqueProjects = Array.from(new Set(elnData.map(n => n.project || '기본 프로젝트')));
  const projectStats = uniqueProjects.map(p => {
    const notesInProject = elnData.filter(n => (n.project || '기본 프로젝트') === p && !n.isTemplate);
    const lastDates = notesInProject.map(n => new Date(n.date).getTime()).filter(t => !isNaN(t));
    return {
      name: p,
      count: notesInProject.length,
      approved: notesInProject.filter(n => n.status === '승인됨').length,
      progress: notesInProject.filter(n => n.status === '진행중' || n.status === '1차 승인').length,
      lastUpdated: lastDates.length > 0 ? new Date(Math.max(...lastDates)).toLocaleDateString() : '기록 없음'
    };
  });

  const tabStyle = (isActive) => ({
    padding: '0.75rem 1.5rem',
    cursor: 'pointer',
    borderBottom: isActive ? '3px solid var(--primary-color)' : '3px solid transparent',
    color: isActive ? 'var(--primary-color)' : 'var(--text-muted)',
    fontWeight: isActive ? '700' : '500',
    fontSize: '1.05rem',
    background: 'none',
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    transition: 'all 0.2s'
  });

  return (
    <div className="dashboard-content">
      <div className="card-header" style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>연구노트 (ELN)</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-outline" onClick={handleExportCSV}>
            <i className="fa-solid fa-file-csv"></i> CSV 내보내기
          </button>
          <button className="btn-primary" onClick={handleCreateNew}>
            <i className="fa-solid fa-pen-nib"></i> 새 노트 작성
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', gap: '1rem' }}>
        <button style={tabStyle(activeTab === 'notes')} onClick={() => setActiveTab('notes')}>
          연구노트 목록
        </button>
        <button style={tabStyle(activeTab === 'projects')} onClick={() => setActiveTab('projects')}>
          프로젝트 관리
        </button>
      </div>

      {activeTab === 'notes' ? (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="search-bar" style={{ flex: 1, width: 'auto' }}>
              <i className="fa-solid fa-search"></i>
              <input type="text" placeholder="노트 제목 또는 작성자 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <select className="form-input" style={{ width: '150px', padding: '0.5rem' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">전체 상태</option>
              <option value="진행중">⏳ 진행중</option>
              <option value="1차 승인">🟡 1차 승인</option>
              <option value="승인됨">✅ 승인됨</option>
              <option value="반려">❌ 반려</option>
            </select>
            <select className="form-input" style={{ width: '150px', padding: '0.5rem' }} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="all">전체 프로젝트</option>
              {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="form-input" style={{ width: '150px', padding: '0.5rem' }} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">전체 태그</option>
              {allTags.map(tag => (
                <option key={tag} value={tag}>#{tag}</option>
              ))}
            </select>
          </div>
          
          <div className="card">
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <span className="spinner" style={{ display: 'inline-block', width: '1.5rem', height: '1.5rem', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>노트 제목</th>
                    <th>프로젝트</th>
                    <th>작성자</th>
                    <th>작성일</th>
                    <th>상태</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>작성된 연구노트가 없습니다.</td>
                    </tr>
                  ) : (
                    filteredData.map((note) => (
                      <tr key={note.id} onClick={() => handleEdit(note.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ color: 'var(--primary-color)', fontWeight: '600' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span>{note.title}</span>
                            {note.tags && note.tags.length > 0 && (
                              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                {note.tags.map(tag => (
                                  <span key={tag} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', backgroundColor: 'var(--bg-color)', padding: '1px 6px', borderRadius: '10px' }}>#{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td><span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{note.project || '기본 프로젝트'}</span></td>
                        <td>{note.author}</td>
                        <td>{note.date}</td>
                        <td>
                          <span className={`item-status status-${note.status === '승인됨' ? 'done' : note.status === '반려' ? 'danger' : note.status === '1차 승인' ? 'warning' : 'progress'}`}>
                            {note.status}
                          </span>
                        </td>
                        <td>
                          <div className="action-btns">
                            {(note.status === '진행중' || note.status === '1차 승인') && (
                              <>
                                <button className="btn-icon" title={note.status === '진행중' ? '1차 승인' : '최종 승인'} style={{ color: 'var(--success)' }} onClick={(e) => handleApproveClick(note, e)}>
                                  <i className="fa-solid fa-check"></i>
                                </button>
                                <button className="btn-icon" title="반려" style={{ color: 'var(--warning)' }} onClick={(e) => handleReject(note.id, e)}>
                                  <i className="fa-solid fa-xmark"></i>
                                </button>
                              </>
                            )}
                            {note.status === '승인됨' && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>승인 완료</span>
                            )}
                            <button className="btn-icon delete" onClick={(e) => handleDelete(note.id, e)}>
                              <i className="fa-solid fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* Pagination UI */}
            {!loading && useAppStore.getState().elnPagination && useAppStore.getState().elnPagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="btn-outline" 
                  disabled={useAppStore.getState().elnPagination.page === 1}
                  onClick={() => fetchElnData(useAppStore.getState().elnPagination.page - 1, 10, searchTerm)}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  이전
                </button>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  {useAppStore.getState().elnPagination.page} / {useAppStore.getState().elnPagination.totalPages}
                </span>
                <button 
                  className="btn-outline" 
                  disabled={useAppStore.getState().elnPagination.page === useAppStore.getState().elnPagination.totalPages}
                  onClick={() => fetchElnData(useAppStore.getState().elnPagination.page + 1, 10, searchTerm)}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  다음
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card">
          <div className="card-header">
            <h2>프로젝트 통계 및 요약</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>프로젝트 명</th>
                <th>전체 노트 수</th>
                <th>승인됨</th>
                <th>진행/검토 중</th>
                <th>최근 업데이트</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {projectStats.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>진행 중인 프로젝트가 없습니다.</td>
                </tr>
              ) : (
                projectStats.map((p, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>{p.name}</td>
                    <td>{p.count}건</td>
                    <td><span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{p.approved}</span>건</td>
                    <td><span style={{ color: 'var(--warning)', fontWeight: 'bold' }}>{p.progress}</span>건</td>
                    <td>{p.lastUpdated}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => { setActiveTab('notes'); setProjectFilter(p.name); }}>
                          노트 보기
                        </button>
                        {user?.role === 'admin' && (
                          <button className="btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--accent-color)', borderColor: 'var(--accent-color)' }} onClick={() => handleRenameProject(p.name)}>
                            <i className="fa-solid fa-pen" style={{ marginRight: '0.3rem' }}></i> 이름 변경
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal.isOpen && (
        <div className="modal-overlay" onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}>
          <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '90%' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontWeight: 600, fontSize: '1.1rem' }}>
                 {confirmModal.type === 'delete' ? '삭제 확인' : confirmModal.type === 'approve' ? '승인 확인' : '반려 확인'}
              </h3>
              <button className="btn-icon" onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="modal-body" style={{ padding: '2rem 1.5rem', whiteSpace: 'pre-wrap', textAlign: 'center', fontSize: '1rem', lineHeight: '1.5' }}>
              <p>{confirmModal.message}</p>
              {confirmModal.type === 'approve' && (
                <div style={{ marginTop: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#fff' }}>
                  <div style={{ padding: '0.5rem', backgroundColor: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: 'bold' }}>전자 서명</div>
                  <SignatureCanvas 
                    ref={sigCanvas} 
                    canvasProps={{ width: 350, height: 150, className: 'sigCanvas' }} 
                    backgroundColor="white"
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.5rem' }}>
                    <button type="button" className="btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => sigCanvas.current && sigCanvas.current.clear()}>지우기</button>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', padding: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn-secondary" onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}>취소</button>
              <button className={`btn-primary ${confirmModal.type === 'delete' || confirmModal.type === 'reject' ? 'btn-danger' : ''}`} onClick={handleConfirmAction}>
                {confirmModal.type === 'delete' ? '삭제' : confirmModal.type === 'approve' ? '승인' : '반려'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Selection Modal */}
      {templateModal.isOpen && (
        <div className="modal-overlay" onClick={() => setTemplateModal({ isOpen: false })}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontWeight: 600, fontSize: '1.1rem' }}>새 노트 작성 방식 선택</h3>
              <button className="btn-icon" onClick={() => setTemplateModal({ isOpen: false })}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="modal-body" style={{ padding: '2rem 1.5rem' }}>
              <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>저장된 공용 템플릿을 사용하여 시작하거나 빈 문서에서 작성할 수 있습니다.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button 
                  className="btn-outline" 
                  style={{ padding: '1rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '1rem' }}
                  onClick={() => navigate('/eln/new')}
                >
                  <i className="fa-solid fa-file-lines" style={{ fontSize: '1.5rem', color: 'var(--primary-color)' }}></i>
                  <div>
                    <h4 style={{ margin: '0 0 0.25rem 0' }}>새 빈 문서 작성</h4>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>아무 내용이 없는 빈 에디터에서 시작합니다.</span>
                  </div>
                </button>
                <div style={{ borderTop: '1px solid var(--border-color)', margin: '0.5rem 0' }}></div>
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>저장된 템플릿 목록</h4>
                {templates.map(tpl => (
                  <button 
                    key={tpl.id}
                    className="btn-outline" 
                    style={{ padding: '0.75rem 1rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '1rem' }}
                    onClick={() => startFromTemplate(tpl.id)}
                  >
                    <i className="fa-solid fa-clipboard-list" style={{ fontSize: '1.2rem', color: 'var(--success)' }}></i>
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0' }}>{tpl.title}</h4>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>작성자: {tpl.author}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rename Project Modal */}
      {renameModal.isOpen && (
        <div className="modal-overlay" onClick={() => setRenameModal({ isOpen: false, oldName: '', newName: '' })}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '90%' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontWeight: 600, fontSize: '1.1rem' }}>프로젝트 이름 변경</h3>
              <button className="btn-icon" onClick={() => setRenameModal({ isOpen: false, oldName: '', newName: '' })}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="modal-body" style={{ padding: '2rem 1.5rem' }}>
              <p style={{ marginBottom: '1rem', color: 'var(--text-main)', fontSize: '0.95rem' }}>
                <strong>'{renameModal.oldName}'</strong> 프로젝트의 새 이름을 입력하세요.
              </p>
              <input 
                type="text" 
                className="form-input" 
                value={renameModal.newName}
                onChange={(e) => setRenameModal({ ...renameModal, newName: e.target.value })}
                placeholder="새 프로젝트 명"
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setRenameModal({ isOpen: false, oldName: '', newName: '' })}>취소</button>
              <button className="btn-primary" onClick={executeRenameProject}>변경하기</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default ELN;
