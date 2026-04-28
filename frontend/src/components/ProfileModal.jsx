import React, { useState } from 'react';
import useAuthStore from '../store/useAuthStore';

function ProfileModal({ onClose }) {
  const user = useAuthStore(state => state.user);
  const updateProfile = useAuthStore(state => state.updateProfile);

  const [formData, setFormData] = useState({
    name: user?.name || '',
    password: '',
    newPassword: '',
    confirmPassword: '',
    notificationSettings: user?.notificationSettings || {
      email: true,
      inApp: true,
      types: { approvalRequest: true, approvalDone: true, inventoryAlert: true }
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (formData.newPassword !== formData.confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    const result = await updateProfile({
      name: formData.name,
      password: formData.password,
      newPassword: formData.newPassword,
      notificationSettings: formData.notificationSettings
    });

    if (result.success) {
      setSuccess('프로필이 성공적으로 업데이트되었습니다.');
      setTimeout(() => {
        onClose();
      }, 1500);
    } else {
      setError(result.message);
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>프로필 설정</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
            {success && <div style={{ color: 'var(--success)', marginBottom: '1rem', fontSize: '0.9rem' }}>{success}</div>}
            
            <div className="form-group">
              <label>이름</label>
              <input type="text" name="name" className="form-input" value={formData.name} onChange={handleChange} required />
            </div>
            
            <hr style={{ margin: '1.5rem 0', borderColor: 'var(--border-color)' }} />
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>비밀번호 변경 시에만 아래 항목을 입력하세요.</p>
            
            <div className="form-group">
              <label>현재 비밀번호</label>
              <input type="password" name="password" className="form-input" value={formData.password} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>새 비밀번호</label>
              <input type="password" name="newPassword" className="form-input" value={formData.newPassword} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>새 비밀번호 확인</label>
              <input type="password" name="confirmPassword" className="form-input" value={formData.confirmPassword} onChange={handleChange} />
            </div>

            <hr style={{ margin: '1.5rem 0', borderColor: 'var(--border-color)' }} />
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>알림 설정</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={formData.notificationSettings.email} onChange={(e) => setFormData(prev => ({...prev, notificationSettings: {...prev.notificationSettings, email: e.target.checked}}))} />
                이메일 알림 수신
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={formData.notificationSettings.inApp} onChange={(e) => setFormData(prev => ({...prev, notificationSettings: {...prev.notificationSettings, inApp: e.target.checked}}))} />
                앱 내 알림 수신
              </label>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={formData.notificationSettings.types.approvalRequest} onChange={(e) => setFormData(prev => ({...prev, notificationSettings: {...prev.notificationSettings, types: {...prev.notificationSettings.types, approvalRequest: e.target.checked}}}))} />
                승인 요청 알림
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={formData.notificationSettings.types.approvalDone} onChange={(e) => setFormData(prev => ({...prev, notificationSettings: {...prev.notificationSettings, types: {...prev.notificationSettings.types, approvalDone: e.target.checked}}}))} />
                승인 완료/반려 알림
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={formData.notificationSettings.types.inventoryAlert} onChange={(e) => setFormData(prev => ({...prev, notificationSettings: {...prev.notificationSettings, types: {...prev.notificationSettings.types, inventoryAlert: e.target.checked}}}))} />
                시약 재고/만료 알림
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
            <button type="submit" className="btn-primary" disabled={loading}>저장</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProfileModal;
