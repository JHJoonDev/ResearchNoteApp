import React from 'react';
import { saveAs } from 'file-saver';
import api from '../api/axios';
import toast from 'react-hot-toast';

const ReportGenerator = () => {
  const [loading, setLoading] = React.useState(false);

  const downloadReport = async () => {
    setLoading(true);
    try {
      const response = await api.get('/reports/weekly', { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      saveAs(blob, `weekly_report_${new Date().toISOString().split('T')[0]}.pdf`);
      toast.success('보고서 다운로드 완료');
    } catch (err) {
      console.error(err);
      toast.error('보고서 생성 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '800', marginBottom: '1rem', color: 'var(--text-main)' }}>주간 연구 및 재고 보고서</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', lineHeight: '1.6' }}>
          이번 주 작성된 모든 연구노트 요약과 LIMS 재고 현황(임계치 미달 품목 등)을 포함한 통합 PDF 보고서를 생성합니다.
        </p>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button 
            onClick={downloadReport} 
            disabled={loading}
            className="btn-primary"
            style={{ padding: '1rem 2rem', borderRadius: '14px', fontSize: '1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {loading ? (
              <>
                <i className="fa-solid fa-spinner fa-spin"></i> 생성 중...
              </>
            ) : (
              <>
                <i className="fa-solid fa-file-pdf"></i> PDF 보고서 생성
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportGenerator;
