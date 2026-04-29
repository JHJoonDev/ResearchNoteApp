import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '3rem', textAlign: 'center', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h1 style={{ color: 'var(--danger)', marginBottom: '1rem' }}>오류가 발생했습니다.</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>애플리케이션 처리 중 예상치 못한 문제가 발생했습니다. 불편을 드려 죄송합니다.</p>
          <button className="btn-primary" onClick={() => window.location.href = '/'}>
            메인으로 돌아가기
          </button>
          {process.env.NODE_ENV === 'development' && (
            <details style={{ marginTop: '2rem', textAlign: 'left', background: 'var(--surface-color)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', maxWidth: '800px', width: '100%' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>오류 상세 내용 보기</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', marginTop: '1rem', color: 'var(--danger)' }}>
                {this.state.error && this.state.error.toString()}
                <br />
                <span style={{ color: 'var(--text-main)' }}>
                  {this.state.errorInfo && this.state.errorInfo.componentStack}
                </span>
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
