import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useAppStore from '../store/useAppStore';

function Dashboard() {
  const navigate = useNavigate();
  const { elnData, limsData, fetchElnData, fetchLimsData } = useAppStore();

  useEffect(() => {
    fetchElnData();
    fetchLimsData();
  }, [fetchElnData, fetchLimsData]);

  const handleNewNote = () => {
    navigate('/eln');
  };

  const handleAction = (action) => {
    if (action.includes('주문')) {
        alert('구매/발주 관리 모듈로 연동 예정입니다.');
    } else if (action.includes('폐기')) {
        alert('안전관리 가이드에 따라 폐기 트랜잭션을 기록합니다.');
    }
  };

  // KPI Calculations
  const inProgressNotesCount = elnData.filter(n => n.status === '진행중').length;
  const totalReagentsCount = limsData.length;
  const alertsCount = limsData.filter(i => i.status === '부족' || i.status === '만료 예정').length;

  // Recent data (top 2)
  const recentNotes = elnData.slice(0, 2);
  const inventoryAlerts = limsData
    .filter(i => i.status === '부족' || i.status === '만료 예정')
    .slice(0, 2);

  return (
    <div className="dashboard-content">
      <h1 className="page-title">안녕하세요, 연구원님</h1>
      
      <div className="kpi-cards">
        <div className="kpi-card" onClick={() => navigate('/eln')}>
          <div className="kpi-icon blue"><i className="fa-solid fa-book-open"></i></div>
          <div className="kpi-info">
            <h3>작성 중인 노트</h3>
            <p>{inProgressNotesCount}건</p>
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/lims')}>
          <div className="kpi-icon teal"><i className="fa-solid fa-vial-circle-check"></i></div>
          <div className="kpi-info">
            <h3>보유 시약 수</h3>
            <p>{totalReagentsCount.toLocaleString()}개</p>
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/lims')}>
          <div className="kpi-icon red"><i className="fa-solid fa-triangle-exclamation"></i></div>
          <div className="kpi-info">
            <h3>재고 부족 / 만료 임박</h3>
            <p>{alertsCount}건</p>
          </div>
        </div>
      </div>

      <div className="grid-sections">
        <section className="card recent-notes">
          <div className="card-header">
            <h2>최근 연구노트 기록</h2>
            <button className="btn-primary" onClick={handleNewNote}><i className="fa-solid fa-plus"></i> 새 노트 작성</button>
          </div>
          <ul className="item-list">
            {recentNotes.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--text-muted)' }}>최근 기록이 없습니다.</p>
            ) : (
              recentNotes.map(note => (
                <li key={note.id} onClick={() => navigate('/eln')} style={{ cursor: 'pointer' }}>
                  <div className="item-icon"><i className="fa-regular fa-file-lines"></i></div>
                  <div className="item-details">
                    <h4>{note.title}</h4>
                    <span>작성자: {note.author} • {note.date}</span>
                  </div>
                  <div className={`item-status status-${note.status === '승인됨' ? 'done' : 'progress'}`}>
                    {note.status}
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="card inventory-alerts">
          <div className="card-header">
            <h2>시약 인벤토리 알림</h2>
            <a href="#" className="view-all" onClick={(e) => { e.preventDefault(); navigate('/lims'); }}>전체보기</a>
          </div>
          <ul className="item-list">
            {inventoryAlerts.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--text-muted)' }}>알림이 없습니다.</p>
            ) : (
              inventoryAlerts.map(item => (
                <li key={item.id} onClick={() => navigate('/lims')} style={{ cursor: 'pointer' }}>
                  <div className={`item-icon ${item.status === '부족' ? 'warning' : 'danger'}`}>
                    <i className={`fa-solid ${item.status === '부족' ? 'fa-droplet' : 'fa-biohazard'}`}></i>
                  </div>
                  <div className="item-details">
                    <h4>{item.name}</h4>
                    <span>현재 재고: {item.stockValue} {item.unit} ({item.status})</span>
                  </div>
                  <button className="btn-outline" onClick={(e) => { e.stopPropagation(); handleAction(item.status === '부족' ? '주문' : '폐기'); }}>
                    {item.status === '부족' ? '주문 요청' : '폐기 처리'}
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
