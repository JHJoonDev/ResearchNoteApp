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
    role: 'researcher',
    elnRole: '연구원'
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
        role: member.role,
        elnRole: member.elnRole || '연구원'
      });
      setEditingId(member.id);
    } else {
      setFormData({
        name: '',
        email: '',
        role: 'researcher',
        elnRole: '연구원'
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
    if (role === 'admin') return '시스템 관리자';
    if (role === 'researcher') return '시스템 사용자';
    return '방문 사용자';
  };

  const getElnRoleColor = (elnRole) => {
    if (elnRole === '연구소장') return 'var(--danger)'; 
    if (elnRole === '책임연구원') return 'var(--warning)';
    return 'var(--success)';
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
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ backgroundColor: 'var(--bg-secondary)', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {getRoleBadge(member.role)}
                    </span>
                    <span style={{ backgroundColor: 'var(--bg-secondary)', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.8rem', color: getElnRoleColor(member.elnRole), fontWeight: '600' }}>
                      {member.elnRole || '연구원'}
                    </span>
                  </div>
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
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label>앱 사용 권한</label>
                    <select name="role" className="form-input" value={formData.role} onChange={handleInputChange}>
                      <option value="admin">시스템 관리자 (Admin)</option>
                      <option value="researcher">시스템 사용자</option>
                      <option value="viewer">방문 사용자</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label>ELN 결재 권한</label>
                    <select name="elnRole" className="form-input" value={formData.elnRole} onChange={handleInputChange}>
                      <option value="연구원">연구원 (기본 작성자)</option>
                      <option value="책임연구원">책임연구원 (1차 승인)</option>
                      <option value="연구소장">연구소장 (최종 승인)</option>
                    </select>
                  </div>
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
