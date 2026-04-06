import React, { useEffect, useState } from 'react';
import useAppStore from '../store/useAppStore';

function LIMS() {
  const { limsData, loading, fetchLimsData, createLimsItem, updateLimsItem, deleteLimsItem } = useAppStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    brand: '',
    cas: '',
    stockValue: 0,
    unit: 'L',
    status: '양호'
  });

  useEffect(() => {
    fetchLimsData();
  }, [fetchLimsData]);

  const handleOpenModal = (mode, item = null) => {
    setModalMode(mode);
    if (mode === 'edit' && item) {
      setFormData({
        name: item.name,
        brand: item.brand,
        cas: item.cas,
        stockValue: item.stockValue || 0,
        unit: item.unit || 'L',
        status: item.status
      });
      setEditingId(item.id);
    } else {
      setFormData({
        name: '',
        brand: '',
        cas: '',
        stockValue: 0,
        unit: 'L',
        status: '양호'
      });
      setEditingId(null);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (modalMode === 'create') {
      await createLimsItem(formData);
    } else {
      await updateLimsItem(editingId, formData);
    }
    handleCloseModal();
  };

  const handleDelete = async (id) => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      await deleteLimsItem(id);
    }
  };

  const getStatusStyle = (status) => {
    if (status === '부족') return { background: '#FEF3C7', color: '#D97706' };
    if (status === '만료 예정' || status === '만료') return { background: '#FEE2E2', color: '#DC2626' };
    return { background: '#D1FAE5', color: '#059669' };
  };

  return (
    <div className="dashboard-content">
      <div className="card-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>시약 관리 (LIMS)</h1>
        <button className="btn-primary" onClick={() => handleOpenModal('create')}>
          <i className="fa-solid fa-plus"></i> 시약 등록
        </button>
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
                <th>시약명</th>
                <th>제조사</th>
                <th>Cas No.</th>
                <th>재고량</th>
                <th>상태</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {limsData.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>등록된 시약이 없습니다.</td>
                </tr>
              ) : (
                limsData.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.name}</strong></td>
                    <td>{item.brand}</td>
                    <td>{item.cas}</td>
                    <td>{item.stockValue} {item.unit}</td>
                    <td>
                      <span className="item-status" style={getStatusStyle(item.status)}>
                        {item.status}
                      </span>
                    </td>
                    <td>
                      <div className="action-btns">
                        <button className="btn-icon" onClick={() => handleOpenModal('edit', item)}>
                          <i className="fa-solid fa-edit"></i>
                        </button>
                        <button className="btn-icon delete" onClick={() => handleDelete(item.id)}>
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
          <div className="modal-content">
            <div className="modal-header">
              <h2>{modalMode === 'create' ? '새 시약 등록' : '시약 정보 수정'}</h2>
              <button className="close-btn" onClick={handleCloseModal}>&times;</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label>시약명</label>
                  <input type="text" name="name" className="form-input" value={formData.name} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>제조사</label>
                  <input type="text" name="brand" className="form-input" value={formData.brand} onChange={handleInputChange} />
                </div>
                <div className="form-group">
                  <label>Cas No.</label>
                  <input type="text" name="cas" className="form-input" value={formData.cas} onChange={handleInputChange} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>재고량 (숫자만)</label>
                    <input type="number" name="stockValue" className="form-input" value={formData.stockValue} onChange={handleInputChange} required />
                  </div>
                  <div className="form-group">
                    <label>단위</label>
                    <select name="unit" className="form-input" value={formData.unit} onChange={handleInputChange}>
                      <option value="L">L</option>
                      <option value="mL">mL</option>
                      <option value="kg">kg</option>
                      <option value="g">g</option>
                      <option value="mg">mg</option>
                      <option value="ea">ea</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>상태</label>
                  <select name="status" className="form-input" value={formData.status} onChange={handleInputChange}>
                    <option value="양호">양호</option>
                    <option value="부족">부족</option>
                    <option value="만료 예정">만료 예정</option>
                    <option value="만료">만료</option>
                  </select>
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
    </div>
  );
}

export default LIMS;
