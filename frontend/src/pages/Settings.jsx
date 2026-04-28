import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import useAppStore from '../store/useAppStore';

function Settings() {
  const { settings, fetchSettings, updateSettings } = useAppStore();
  const [formData, setFormData] = useState({
    labName: '',
    receiveEmailNotifications: true,
    defaultElnRole: 'researcher',
    theme: 'light'
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings) {
      setFormData({
        labName: settings.labName || '',
        receiveEmailNotifications: settings.receiveEmailNotifications !== false,
        defaultElnRole: settings.defaultElnRole || 'researcher',
        theme: settings.theme || 'light'
      });
    }
  }, [settings]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    await updateSettings(formData);
    useAppStore.getState().setTheme(formData.theme);
    setIsSaving(false);
    toast.success('설정이 저장되었습니다.');
  };

  if (!settings) {
    return (
      <div className="dashboard-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <span className="spinner"></span>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <h1 className="page-title">시스템 설정</h1>
      
      <div className="grid-sections">
        <section className="card">
            <div className="card-header" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h2 style={{ color: 'var(--text-main)' }}>기본 설정</h2>
            </div>
            <div style={{ padding: '1rem 0' }}>
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: 'var(--text-main)' }}>연구실 이름</label>
              <input 
                type="text" 
                name="labName"
                className="form-input" 
                style={{ width: '100%', padding: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '6px' }} 
                value={formData.labName} 
                onChange={handleChange}
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: 'var(--text-main)' }}>기본 멤버 권한</label>
              <select 
                name="defaultElnRole" 
                className="form-input" 
                style={{ width: '100%', padding: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                value={formData.defaultElnRole}
                onChange={handleChange}
              >
                <option value="admin">책임 연구원 (Admin)</option>
                <option value="researcher">연구원</option>
                <option value="viewer">방문 연구원</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: 'var(--text-main)' }}>테마</label>
              <select 
                name="theme" 
                className="form-input" 
                style={{ width: '100%', padding: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                value={formData.theme}
                onChange={handleChange}
              >
                <option value="light">라이트 모드 (Light)</option>
                <option value="dark">다크 모드 (Dark)</option>
              </select>
            </div>

            <div style={{ marginBottom: '2rem' }}>
              <label className="checkbox-container" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main)' }}>
                <input 
                  type="checkbox" 
                  name="receiveEmailNotifications"
                  checked={formData.receiveEmailNotifications} 
                  onChange={handleChange}
                /> 
                시스템 알림 이메일 수신
              </label>
            </div>
            
            <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? '저장 중...' : '설정 저장하기'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
