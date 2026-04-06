import React, { useEffect, useState } from 'react';
import useAppStore from '../store/useAppStore';

function Members() {
  const { membersData, loading, fetchMembers, createMember, updateMember, deleteMember } = useAppStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'researcher'
  });

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleOpenModal = (mode, member = null) => {
    setModalMode(mode);
    if (mode === 'edit' && member) {
      setFormData({
        name: member.name,
        email: member.email,
        role: member.role
      });
      setEditingId(member.id);
    } else {
      setFormData({
        name: '',
        email: '',
        role: 'researcher'
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
      await createMember(formData);
    } else {
      await updateMember(editingId, formData);
    }
    handleCloseModal();
  };

  const handleDelete = async (id) => {
    if (window.confirm('정말 이 멤버를 삭제하시겠습니까?')) {
      await deleteMember(id);
    }
  };

  const getRoleBadge = (role) => {
    if (role === 'admin') return '책임 연구원 (Admin)';
    if (role === 'researcher') return '연구원';
    return '방문 연구원';
  };

  const getAvatarColor = (role) => {
    if (role === 'admin') return '0D8ABC';
    if (role === 'researcher') return '10B981';
    return '6B7280';
  };

  return (
    <div className="dashboard-content">
      <div className="card-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>연구실 멤버</h1>
        <button className="btn-primary" onClick={() => handleOpenModal('create')}>
          <i className="fa-solid fa-user-plus"></i> 멤버 초대
        </button>
      </div>
      
      <div className="card">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <span className="spinner" style={{ display: 'inline-block', width: '1.5rem', height: '1.5rem', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {membersData.length === 0 ? (
              <p style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 멤버가 없습니다.</p>
            ) : (
              membersData.map((member) => (
                <div key={member.id} className="kpi-card" style={{ flexDirection: 'column', alignItems: 'center', padding: '2rem', textAlign: 'center', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
                    <div className="action-btns">
                      <button className="btn-icon" onClick={() => handleOpenModal('edit', member)}>
                        <i className="fa-solid fa-edit"></i>
                      </button>
                      <button className="btn-icon delete" onClick={() => handleDelete(member.id)}>
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                  <img 
                    src={`https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=${getAvatarColor(member.role)}&color=fff`} 
                    alt="User" 
                    style={{ width: '80px', height: '80px', borderRadius: '50%', marginBottom: '1.5rem', border: '4px solid #F3F4F6' }} 
                  />
                  <h3 style={{ fontSize: '1.3rem', marginBottom: '0.4rem', fontWeight: '700' }}>{member.name}</h3>
                  <p style={{ color: 'var(--primary-color)', fontSize: '0.9rem', fontWeight: '600', marginBottom: '0.5rem' }}>{getRoleBadge(member.role)}</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{member.email}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{modalMode === 'create' ? '새 멤버 초대' : '멤버 정보 수정'}</h2>
              <button className="close-btn" onClick={handleCloseModal}>&times;</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label>이름</label>
                  <input type="text" name="name" className="form-input" value={formData.name} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>이메일</label>
                  <input type="email" name="email" className="form-input" value={formData.email} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>권한</label>
                  <select name="role" className="form-input" value={formData.role} onChange={handleInputChange}>
                    <option value="admin">책임 연구원 (Admin)</option>
                    <option value="researcher">연구원</option>
                    <option value="viewer">방문 연구원</option>
                  </select>
                </div>
                {modalMode === 'create' && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '-0.5rem' }}>
                    * 초기 비밀번호는 'password'로 설정됩니다.
                  </p>
                )}
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

export default Members;
