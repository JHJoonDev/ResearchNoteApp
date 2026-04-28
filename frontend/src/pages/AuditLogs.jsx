import React, { useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchLogs = async (pageNumber) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`http://localhost:5000/api/audit?page=${pageNumber}&limit=20`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLogs(res.data.logs);
      setTotalPages(res.data.totalPages);
      setPage(res.data.currentPage);
    } catch (error) {
      toast.error('감사 로그를 불러오지 못했습니다.');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs(page);
  }, []);

  return (
    <div className="dashboard-content">
      <h1 className="page-title">시스템 감사 로그</h1>
      
      <div className="card">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <span className="spinner"></span>
          </div>
        ) : (
          <>
            <table className="data-table" style={{ fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  <th>일시</th>
                  <th>작업자</th>
                  <th>작업</th>
                  <th>대상</th>
                  <th>상세 내용</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>기록이 없습니다.</td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                      <td><strong>{log.user}</strong></td>
                      <td>
                        <span style={{ 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '12px', 
                          background: 'var(--surface-color)',
                          border: '1px solid var(--border-color)',
                          fontSize: '0.8rem'
                        }}>
                          {log.action}
                        </span>
                      </td>
                      <td>{log.target}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{log.details || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="btn-outline" 
                  disabled={page === 1}
                  onClick={() => fetchLogs(page - 1)}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  이전
                </button>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  {page} / {totalPages}
                </span>
                <button 
                  className="btn-outline" 
                  disabled={page === totalPages}
                  onClick={() => fetchLogs(page + 1)}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default AuditLogs;
