import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatTimestampStatus } from '../lib/display';

async function sha256(file) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function Verify() {
  const { verifyId } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [pdfHash, setPdfHash] = useState('');
  const [fileError, setFileError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get(`/public/verify/${encodeURIComponent(verifyId)}`)
      .then(({ data }) => active && setResult(data))
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [verifyId]);

  const choosePdf = async (file) => {
    setPdfHash('');
    setFileError('');
    if (!file) return;
    try {
      setPdfHash(await sha256(file));
    } catch {
      setFileError('이 브라우저에서 파일 해시를 계산하지 못했습니다.');
    }
  };

  const timestamp = result?.timestamp;
  const matchesPdf =
    pdfHash && result?.pdfSha256
      ? pdfHash.toLowerCase() === result.pdfSha256.toLowerCase()
      : null;
  return (
    <main className="dashboard-content public-verify">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLIC VERIFICATION</p>
          <h1 className="page-title">봉인 공개 검증</h1>
          <p className="muted">공개 검증 API가 반환한 결과만 표시합니다. 파일은 서버로 전송하지 않습니다.</p>
        </div>
        <Link className="btn-outline" to="/login">
          로그인
        </Link>
      </div>
      <section className="card verify-card">
        <h2>공개 검증 결과</h2>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {!result && !error && <p role="status">검증 결과를 불러오는 중…</p>}
        {result && (
          <>
            <p className={result.valid ? 'verify-result valid' : 'verify-result invalid'}>
              {result.valid ? '검증 유효' : '검증 실패'}
            </p>
            <dl className="verify-summary">
              <div>
                <dt>봉인 해시</dt>
                <dd><code className="hash-value">{result.sealHash || '미제공'}</code></dd>
              </div>
              <div>
                <dt>봉인 PDF SHA-256</dt>
                <dd><code className="hash-value">{result.pdfSha256 || '미제공'}</code></dd>
              </div>
              <div>
                <dt>봉인 시각</dt>
                <dd>{result.sealedAt ? new Date(result.sealedAt).toLocaleString() : '미제공'}</dd>
              </div>
              <div>
                <dt>시점인증 상태</dt>
                <dd>
                  {formatTimestampStatus(timestamp)}
                </dd>
              </div>
              <div>
                <dt>인증서 시각(genTime)</dt>
                <dd>
                  {timestamp?.genTime
                    ? new Date(timestamp.genTime).toLocaleString()
                    : '시점인증 시각 없음'}
                </dd>
              </div>
              <div>
                <dt>알고리즘</dt>
                <dd>{result.algorithm || '미제공'}</dd>
              </div>
            </dl>
          </>
        )}
      </section>
      <section className="card">
        <h2>내 PDF의 SHA-256 계산</h2>
        <p className="muted">
          파일은 브라우저 안에서만 처리합니다. 봉인 해시와 PDF 해시는 서로 다른 값이며, PDF 일치 여부는
          아래 봉인 PDF SHA-256과 대조합니다.
        </p>
        <label className="upload-label">
          PDF 선택
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => choosePdf(e.target.files[0])} />
        </label>
        {fileError && <p role="alert" className="error-banner">{fileError}</p>}
        {pdfHash && (
          <div className="pdf-hash-check" aria-live="polite">
            <p>선택한 PDF SHA-256: <code className="hash-value">{pdfHash}</code></p>
            {matchesPdf === true && <p className="verify-result valid">PDF 해시 일치</p>}
            {matchesPdf === false && <p className="verify-result invalid">PDF 해시 불일치</p>}
            {matchesPdf === null && !error && <p className="muted">공개 PDF 해시를 불러오면 대조합니다.</p>}
          </div>
        )}
      </section>
    </main>
  );
}
