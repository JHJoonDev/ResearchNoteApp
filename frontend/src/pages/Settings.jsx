import React from 'react';

function Settings() {
  return (
    <div className="dashboard-content">
      <h1 className="page-title">시스템 설정</h1>
      
      <div className="grid-sections">
        <section className="card">
          <div className="card-header">
            <h2>기본 설정</h2>
          </div>
          <div style={{ padding: '1rem 0' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.5rem' }}>연구실 이름</strong>
              <input type="text" className="form-input" style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px' }} defaultValue="미래융합연구소" />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label className="checkbox-container">
                <input type="checkbox" defaultChecked /> 알림 이메일 수신
              </label>
            </div>
            <button className="btn-primary">저장하기</button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
