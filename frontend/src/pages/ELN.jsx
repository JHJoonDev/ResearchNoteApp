import React, { useEffect, useState } from 'react';
import useAppStore from '../store/useAppStore';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

function ELN() {
  const { elnData, loading, fetchElnData, createElnNote, updateElnNote, deleteElnNote, limsData, fetchLimsData } = useAppStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [formData, setFormData] = useState({ title: '', author: 'Senior Dev', content: '', reagentsUsed: [] });
  const [editingId, setEditingId] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Temporary state for adding a reagent
  const [selectedReagent, setSelectedReagent] = useState('');
  const [reagentAmount, setReagentAmount] = useState(0);

  useEffect(() => {
    fetchElnData();
    fetchLimsData();
  }, [fetchElnData, fetchLimsData]);

  const handleOpenModal = (mode, note = null) => {
    setModalMode(mode);
    if (mode === 'edit' && note) {
      setFormData({ 
        title: note.title, 
        author: note.author, 
        content: note.content || '', 
        reagentsUsed: note.reagentsUsed || [] 
      });
      setEditingId(note.id);
    } else {
      setFormData({ title: '', author: 'Senior Dev', content: '', reagentsUsed: [] });
      setEditingId(null);
    }
    setIsModalOpen(true);
  };

  const handleOpenViewModal = (note) => {
    setSelectedNote(note);
    setIsViewModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setIsViewModalOpen(false);
    setFormData({ title: '', author: 'Senior Dev', content: '', reagentsUsed: [] });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditorChange = (content) => {
    setFormData((prev) => ({ ...prev, content }));
  };

  const handleAddReagent = () => {
    if (!selectedReagent || reagentAmount <= 0) return;
    const item = limsData.find(i => i.id === selectedReagent);
    if (!item) return;

    const newReagent = {
      reagentId: item.id,
      name: item.name,
      amount: Number(reagentAmount),
      unit: item.unit
    };

    setFormData(prev => ({
      ...prev,
      reagentsUsed: [...prev.reagentsUsed, newReagent]
    }));
    
    // Reset selection
    setSelectedReagent('');
    setReagentAmount(0);
  };

  const handleRemoveReagent = (idx) => {
    setFormData(prev => ({
      ...prev,
      reagentsUsed: prev.reagentsUsed.filter((_, i) => i !== idx)
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (modalMode === 'create') {
      await createElnNote(formData);
    } else {
      await updateElnNote(editingId, formData);
    }
    handleCloseModal();
  };

  const handleDelete = async (id) => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      await deleteElnNote(id);
    }
  };

  const filteredData = elnData.filter(note => {
    const matchesSearch = note.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          note.author.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || note.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['link', 'image', 'code-block'],
      ['clean']
    ],
  };

  return (
    <div className="dashboard-content">
      <div className="card-header" style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>연구노트 (ELN)</h1>
        <button className="btn-primary" onClick={() => handleOpenModal('create')}>
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
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-color)' }}>
            <span className="spinner" style={{ display: 'inline-block', width: '1.5rem', height: '1.5rem', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
            <p style={{ marginTop: '1rem' }}>데이터를 불러오는 중입니다...</p>
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
                  <tr key={note.id}>
                    <td onClick={() => handleOpenViewModal(note)} style={{ cursor: 'pointer', color: 'var(--primary-color)', fontWeight: '600' }}>
                      {note.title}
                    </td>
                    <td>{note.author}</td>
                    <td>{note.date}</td>
                    <td>
                      <span className={`item-status status-${note.status === '승인됨' ? 'done' : note.status === '반려' ? 'danger' : 'progress'}`} style={note.status === '반려' ? {backgroundColor: '#FEE2E2', color: '#B91C1C'} : {}}>
                        {note.status}
                      </span>
                    </td>
                    <td>
                      <div className="action-btns">
                        <button className="btn-icon" onClick={() => handleOpenModal('edit', note)}>
                          <i className="fa-solid fa-edit"></i>
                        </button>
                        <button className="btn-icon delete" onClick={() => handleDelete(note.id)}>
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

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content wide">
            <div className="modal-header">
              <h2>{modalMode === 'create' ? '새 연구노트 작성' : '연구노트 수정'}</h2>
              <button className="close-btn" onClick={handleCloseModal}>&times;</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>제목</label>
                    <input type="text" name="title" className="form-input" value={formData.title} onChange={handleInputChange} required />
                  </div>
                  <div className="form-group">
                    <label>작성자</label>
                    <input type="text" name="author" className="form-input" value={formData.author} disabled style={{ backgroundColor: '#F3F4F6' }} />
                  </div>
                </div>

                <div className="form-group">
                  <label>연구 내용</label>
                  <ReactQuill 
                    theme="snow" 
                    value={formData.content} 
                    onChange={handleEditorChange} 
                    modules={quillModules}
                    className="quill-editor"
                  />
                </div>

                <div className="reagent-selector">
                  <h3>소모 시약 추가</h3>
                  <div className="reagent-add-row">
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.8rem' }}>시약 선택</label>
                      <select className="form-input" value={selectedReagent} onChange={(e) => setSelectedReagent(e.target.value)}>
                        <option value="">시약을 선택하세요</option>
                        {limsData.map(item => (
                          <option key={item.id} value={item.id}>{item.name} ({item.stockValue} {item.unit} 보유)</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.8rem' }}>사용량</label>
                      <input type="number" className="form-input" value={reagentAmount} onChange={(e) => setReagentAmount(e.target.value)} />
                    </div>
                    <button type="button" className="btn-primary" onClick={handleAddReagent} style={{ height: '42px' }}>추가</button>
                  </div>

                  <div className="reagent-tag-list">
                    {formData.reagentsUsed.map((r, idx) => (
                      <div key={idx} className="reagent-tag">
                        <span>{r.name}: {r.amount} {r.unit}</span>
                        <button type="button" onClick={() => handleRemoveReagent(idx)}>&times;</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={handleCloseModal}>취소</button>
                <button type="submit" className="btn-primary">저장</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isViewModalOpen && selectedNote && (
        <div className="modal-overlay">
          <div className="modal-content wide">
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <h2 style={{ margin: 0 }}>연구노트 상세</h2>
                <span className={`item-status status-${selectedNote.status === '승인됨' ? 'done' : selectedNote.status === '반려' ? 'danger' : 'progress'}`}>
                  {selectedNote.status}
                </span>
              </div>
              <button className="close-btn" onClick={handleCloseModal}>&times;</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              <div className="note-detail-header" style={{ marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid #E5E7EB' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--text-main)' }}>{selectedNote.title}</h1>
                <div style={{ display: 'flex', gap: '1.5rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                  <span><i className="fa-solid fa-user"></i> <strong>작성자:</strong> {selectedNote.author}</span>
                  <span><i className="fa-solid fa-calendar"></i> <strong>작성일:</strong> {selectedNote.date}</span>
                </div>
              </div>
              
              <div className="note-content-rendered ql-editor" dangerouslySetInnerHTML={{ __html: selectedNote.content }} style={{ padding: 0, marginBottom: '2.5rem', minHeight: 'auto' }}></div>
              
              {selectedNote.reagentsUsed && selectedNote.reagentsUsed.length > 0 && (
                <div className="reagent-selector" style={{ background: '#F8FAFC', padding: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>소모 시약 내역</h3>
                  <div className="reagent-tag-list">
                    {selectedNote.reagentsUsed.map((r, idx) => (
                      <div key={idx} className="reagent-tag" style={{ background: 'white', borderColor: '#CBD5E1', color: '#475569' }}>
                        <span><i className="fa-solid fa-vial"></i> {r.name}: {r.amount} {r.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={handleCloseModal}>닫기</button>
              <button className="btn-primary" onClick={() => { handleCloseModal(); handleOpenModal('edit', selectedNote); }}>편집하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ELN;
