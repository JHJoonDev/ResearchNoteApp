import React, { useEffect, useState } from 'react';
import useAppStore from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';

function ELN() {
  const navigate = useNavigate();
  const { elnData, loading, fetchElnData, deleteElnNote, updateElnStatus } = useAppStore();
  const user = useAuthStore(state => state.user);
  
  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    fetchElnData();
  }, [fetchElnData]);

  const handleCreateNew = () => {
    navigate('/eln/new');
  };

  const handleEdit = (id) => {
    navigate(`/eln/${id}`);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('정말 삭제하시겠습니까?')) {
      await deleteElnNote(id);
    }
  };

  const handleApprove = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('이 연구노트를 승인하시겠습니까?\n승인 시 시약 재고가 차감됩니다.')) {
      await updateElnStatus(id, '승인됨');
      fetchElnData();
    }
  };

  const handleReject = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('이 연구노트를 반려하시겠습니까?')) {
      await updateElnStatus(id, '반려');
      fetchElnData();
    }
  };

  const filteredData = elnData.filter(note => {
    const matchesSearch = note.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          note.author.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || note.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="dashboard-content">
      <div className="card-header" style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>연구노트 (ELN)</h1>
        <button className="btn-primary" onClick={handleCreateNew}>
          <i className="fa-solid fa-pen-nib"></i> 새 노트 작성
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="search-bar" style={{ flex: 1, width: 'auto' }}>
          <i className="fa-solid fa-search"></i>
          <input type="text" placeholder="노트 제목 또는 작성자 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <select className="form-input" style={{ width: '150px', padding: '0.5rem' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">전체 상태</option>
          <option value="진행중">⏳ 진행중</option>
          <option value="승인됨">✅ 승인됨</option>
          <option value="반려">❌ 반려</option>
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
                <th>작성자</th>
                <th>작성일</th>
                <th>상태</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>작성된 연구노트가 없습니다.</td>
                </tr>
              ) : (
                filteredData.map((note) => (
                  <tr key={note.id} onClick={() => handleEdit(note.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ color: 'var(--primary-color)', fontWeight: '600' }}>
                      {note.title}
                    </td>
                    <td>{note.author}</td>
                    <td>{note.date}</td>
                    <td>
                      <span className={`item-status status-${note.status === '승인됨' ? 'done' : note.status === '반려' ? 'danger' : 'progress'}`}>
                        {note.status}
                      </span>
                    </td>
                    <td>
                      <div className="action-btns">
                        {note.status === '진행중' && (
                          <>
                            <button className="btn-icon" title="승인" style={{ color: 'var(--success)' }} onClick={(e) => handleApprove(note.id, e)}>
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
      </div>
    </div>
  );
}

export default ELN;
