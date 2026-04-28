import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import useAppStore from '../store/useAppStore';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar, Legend
} from 'recharts';

const PIE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444'];

function Dashboard() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = React.useState({ start: '', end: '' });
  const { elnData, limsData, fetchElnData, fetchLimsData, dashboardStats, fetchDashboardStats, disposeReagent, orderReagent } = useAppStore();

  useEffect(() => {
    fetchElnData();
    fetchLimsData();
    fetchDashboardStats(dateRange.start, dateRange.end);
  }, [fetchElnData, fetchLimsData, fetchDashboardStats, dateRange]);

  const handleNewNote = () => navigate('/eln');

  const handleAction = async (item, action) => {
    if (action.includes('주문')) {
      if (window.confirm(`${item.name}의 구매 요청을 진행하시겠습니까?`)) {
        await orderReagent(item.id);
        toast.success('구매 요청이 완료되었습니다.');
      }
    } else if (action.includes('폐기')) {
      if (window.confirm(`${item.name}의 폐기 처리를 진행하시겠습니까?`)) {
        await disposeReagent(item.id);
        toast.success('폐기 처리가 완료되었습니다.');
      }
    }
  };

  // KPI Calculations
  const inProgressNotesCount = elnData.filter(n => n.status === '진행중').length;
  const totalReagentsCount = limsData.length;
  const alertsCount = limsData.filter(i => i.status === '부족' || i.status === '만료 예정').length;
  const approvedCount = elnData.filter(n => n.status === '승인됨').length;

  // Recent data
  const recentNotes = elnData.filter(n => !n.isTemplate).slice(0, 3);
  const inventoryAlerts = limsData
    .filter(i => i.status === '부족' || i.status === '만료 예정')
    .slice(0, 3);

  const stats = dashboardStats;

  // Custom tooltip for pie chart
  const renderPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
          <span style={{ fontWeight: 600 }}>{payload[0].name}</span>: {payload[0].value}건
        </div>
      );
    }
    return null;
  };

  return (
    <div className="dashboard-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>대시보드</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>조회 기간:</span>
          <input 
            type="date" 
            className="form-input" 
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: 'auto' }}
            value={dateRange.start}
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
          />
          <span style={{ color: 'var(--text-muted)' }}>~</span>
          <input 
            type="date" 
            className="form-input" 
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: 'auto' }}
            value={dateRange.end}
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
          />
          <button 
            className="btn-outline" 
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
            onClick={() => setDateRange({ start: '', end: '' })}
          >
            초기화
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-cards">
        <div className="kpi-card" onClick={() => navigate('/eln')}>
          <div className="kpi-icon blue"><i className="fa-solid fa-pen-nib"></i></div>
          <div className="kpi-info">
            <h3>작성 중인 노트</h3>
            <p>{inProgressNotesCount}건</p>
          </div>
        </div>
        <div className="kpi-card" onClick={() => navigate('/eln')}>
          <div className="kpi-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}><i className="fa-solid fa-check-double"></i></div>
          <div className="kpi-info">
            <h3>승인 완료</h3>
            <p>{approvedCount}건</p>
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
            <h3>재고 알림</h3>
            <p>{alertsCount}건</p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      {stats && (
        <div className="dashboard-charts-row">
          {/* Monthly Trend - Area Chart */}
          <section className="card chart-card">
            <div className="card-header">
              <h2><i className="fa-solid fa-chart-line" style={{ marginRight: '0.5rem', color: 'var(--primary-color)' }}></i>월별 연구노트 작성 추이</h2>
            </div>
            <div style={{ width: '100%', height: 260, padding: '0.5rem 0' }}>
              <ResponsiveContainer>
                <AreaChart data={stats.monthlyTrend} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                    labelStyle={{ color: 'var(--text-main)', fontWeight: 600 }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCount)" name="작성 건수" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Approval Status - Pie Chart */}
          <section className="card chart-card">
            <div className="card-header">
              <h2><i className="fa-solid fa-chart-pie" style={{ marginRight: '0.5rem', color: '#f59e0b' }}></i>결재 현황</h2>
            </div>
            <div style={{ width: '100%', height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={stats.approvalStats.filter(s => s.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name} ${value}`}
                  >
                    {stats.approvalStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={renderPieTooltip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}

      {/* Second Charts Row */}
      {stats && (
        <div className="dashboard-charts-row">
          {/* Reagent Top 5 - Bar Chart */}
          <section className="card chart-card">
            <div className="card-header">
              <h2><i className="fa-solid fa-flask" style={{ marginRight: '0.5rem', color: '#10b981' }}></i>시약 사용량 Top 5</h2>
            </div>
            <div style={{ width: '100%', height: 260, padding: '0.5rem 0' }}>
              {stats.reagentTop5.length > 0 ? (
                <ResponsiveContainer>
                  <BarChart data={stats.reagentTop5} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                    />
                    <Bar dataKey="usage" fill="#10b981" radius={[6, 6, 0, 0]} name="사용량" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  <p>시약 사용 기록이 없습니다.</p>
                </div>
              )}
            </div>
          </section>

          {/* Author Ranking */}
          <section className="card chart-card">
            <div className="card-header">
              <h2><i className="fa-solid fa-ranking-star" style={{ marginRight: '0.5rem', color: '#f59e0b' }}></i>연구원별 활동량</h2>
            </div>
            <div style={{ padding: '1rem' }}>
              {stats.authorRanking.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {stats.authorRanking.map((author, idx) => {
                    const maxCount = stats.authorRanking[0].count;
                    const pct = maxCount > 0 ? (author.count / maxCount) * 100 : 0;
                    const medals = ['🥇', '🥈', '🥉'];
                    return (
                      <div key={author.name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ width: '2rem', textAlign: 'center', fontSize: '1.2rem' }}>
                          {idx < 3 ? medals[idx] : <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{idx + 1}</span>}
                        </span>
                        <span style={{ width: '5rem', fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author.name}</span>
                        <div style={{ flex: 1, height: '1.5rem', background: 'var(--bg-color)', borderRadius: '8px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: idx === 0 ? 'linear-gradient(90deg, #6366f1, #818cf8)' : idx === 1 ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)' : 'linear-gradient(90deg, #94a3b8, #cbd5e1)',
                            borderRadius: '8px',
                            transition: 'width 0.8s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            paddingRight: '0.5rem'
                          }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>{author.count}건</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--text-muted)' }}>
                  <p>활동 기록이 없습니다.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Recent Notes & Alerts */}
      <div className="grid-sections">
        <section className="card recent-notes">
          <div className="card-header">
            <h2>최근 연구노트</h2>
            <button className="btn-primary" onClick={handleNewNote}><i className="fa-solid fa-plus"></i> 새 노트 작성</button>
          </div>
          <ul className="item-list">
            {recentNotes.length === 0 ? (
              <p style={{ padding: '1rem', color: 'var(--text-muted)' }}>최근 기록이 없습니다.</p>
            ) : (
              recentNotes.map(note => (
                <li key={note.id} onClick={() => navigate(`/eln/${note.id}`)} style={{ cursor: 'pointer' }}>
                  <div className="item-icon"><i className="fa-regular fa-file-lines"></i></div>
                  <div className="item-details">
                    <h4>{note.title}</h4>
                    <span>작성자: {note.author} • {note.date}</span>
                  </div>
                  <div className={`item-status status-${note.status === '승인됨' ? 'done' : note.status === '반려' ? 'danger' : note.status === '1차 승인' ? 'warning' : 'progress'}`}>
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
                  <button className="btn-outline" onClick={(e) => { e.stopPropagation(); handleAction(item, item.status === '부족' ? '주문' : '폐기'); }}>
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
