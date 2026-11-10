import { PageHeader, Card } from '../components/ui';
import '../styles/operations.css';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { encodeLabel, renderLabelSvg } from '@labhub/label-kit';
import { LabelScanner } from '@labhub/label-kit/react';
import { api, downloadBlob, errorMessage } from '../lib/api';
import { asList, entityName, recordId } from '../lib/phase3';
import { formatQuantity } from '../lib/display';

const printableTypes = ['reagent', 'lot', 'sample', 'equipment', 'location'];
const typeLabels = { reagent: '시약', lot: 'LOT', sample: '샘플', equipment: '장비', location: '위치' };
const templates = ['25x10', '38x19', '50x25', '70x37'];

export default function ScanLabels() {
  const [type, setType] = useState('reagent');
  const [reagents, setReagents] = useState([]);
  const [reagentForLots, setReagentForLots] = useState('');
  const [records, setRecords] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [template, setTemplate] = useState('50x25');
  const [sheet, setSheet] = useState('50x25');
  const [startOffset, setStartOffset] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [legacyCode, setLegacyCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedRecords = useMemo(() => selectedIds.map((id) => records.find((record) => recordId(record) === id)).filter(Boolean), [records, selectedIds]);
  const previewRecord = selectedRecords[0];

  useEffect(() => {
    if (type !== 'lot') { setReagentForLots(''); setRecords([]); setSelectedIds([]); }
    if (type === 'reagent') api.get('/lims').then(({ data }) => setRecords(asList(data))).catch((e) => setError(errorMessage(e)));
    else if (type === 'location') api.get('/locations').then(({ data }) => setRecords(asList(data).filter((location) => !location.isDeleted))).catch((e) => setError(errorMessage(e)));
    else if (type === 'sample' || type === 'equipment') {
      Promise.all([api.get('/entity-types'), api.get('/entities', { params: { page: 1, limit: 200 } })])
        .then(([typeResponse, entityResponse]) => {
          const allowed = new Set(asList(typeResponse.data).filter((entityType) => entityType.kind === type).map(recordId));
          setRecords(asList(entityResponse.data).filter((entity) => allowed.has(String(entity.typeId))));
        }).catch((e) => setError(errorMessage(e)));
    } else if (type === 'lot') api.get('/lims').then(({ data }) => setReagents(asList(data))).catch((e) => setError(errorMessage(e)));
  }, [type]);

  useEffect(() => {
    let active = true;
    if (type !== 'lot' || !reagentForLots) { if (type === 'lot') { setRecords([]); setSelectedIds([]); } return () => { active = false; }; }
    api.get(`/lims/${encodeURIComponent(reagentForLots)}/lots`).then(({ data }) => active && setRecords(asList(data))).catch((e) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [type, reagentForLots]);

  useEffect(() => {
    if (!previewRecord) { setPreviewUrl(''); return undefined; }
    let url = '';
    try {
      const details = type === 'lot'
        ? [`LOT ${previewRecord.lotNumber}`, `${formatQuantity(previewRecord.remainingAmount)} ${previewRecord.unit || ''}`, previewRecord.expirationDate || '']
        : type === 'reagent'
          ? [previewRecord.cas ? `CAS ${previewRecord.cas}` : '', previewRecord.location || '', `재고 ${formatQuantity(previewRecord.stockValue)} ${previewRecord.unit || ''}`]
          : [previewRecord.code || '', previewRecord.location || '', previewRecord.status || ''];
      const svg = renderLabelSvg({ type, id: recordId(previewRecord), title: entityName(previewRecord), detailLines: details.filter(Boolean), ghsCodes: previewRecord.ghsPictograms || [] }, template);
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      setPreviewUrl(url);
    } catch (e) { setError(e.message || 'SVG 미리보기를 만들지 못했습니다.'); setPreviewUrl(''); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [previewRecord, type, template]);

  const resolveCode = async (code) => {
    setBusy(true); setError(''); setNotice(''); setScanResult(null);
    try {
      const { data } = await api.get('/scan/resolve', { params: { code } });
      const target = new URL(data.url, window.location.origin);
      if (target.origin !== window.location.origin) throw new Error('서버가 현재 서비스 외부의 이동 주소를 반환했습니다.');
      setScanResult({ ...data, url: `${target.pathname}${target.search}${target.hash}` });
      setNotice(`${data.title || data.type} 항목을 찾았습니다.`);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const onScan = ({ type: scannedType, id }) => resolveCode(encodeLabel({ type: scannedType, id }));

  const downloadPdf = async () => {
    if (!selectedRecords.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.post('/labels/pdf', { items: selectedRecords.map((record) => ({ type, id: recordId(record) })), sheet, startOffset: Number(startOffset) }, { responseType: 'blob' });
      downloadBlob(data, 'labhub-labels.pdf', 'application/pdf'); setNotice('서버에서 라벨 PDF를 만들었습니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const downloadZpl = async () => {
    if (!selectedRecords.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.post('/labels/zpl', { items: selectedRecords.map((record) => ({ type, id: recordId(record) })), template }, { responseType: 'blob' });
      downloadBlob(data, 'labhub-labels.zpl', 'text/plain;charset=utf-8'); setNotice('서버에서 ZPL 라벨을 만들었습니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return <div className="dashboard-content operations-page phase3-page">
    <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '재고·장비' }, { label: '라벨 스캔' }]} title="라벨 스캔·인쇄" description="LH1 코드를 스캔하고, 서버 데이터에 기반한 PDF/ZPL 라벨을 만듭니다." />
    {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status" className="notice-banner">{notice}</p>}
    <Card className="card phase3-card"><h2>라벨 스캔</h2><LabelScanner onScan={onScan} onError={(e) => setError(e.message || '카메라를 사용할 수 없습니다.')} /><form className="legacy-scan-form" onSubmit={(e) => { e.preventDefault(); if (legacyCode.trim()) resolveCode(legacyCode.trim()); }}><label>이전 원시 시약 ID 입력<input className="form-input" value={legacyCode} onChange={(e) => setLegacyCode(e.target.value)} placeholder="기존 인쇄 라벨용" /></label><button className="btn-outline" disabled={busy || !legacyCode.trim()}>기존 라벨 조회</button></form>{scanResult && <div className="scan-result"><strong>{scanResult.title || typeLabels[scanResult.type] || '항목'}</strong><span>{typeLabels[scanResult.type] || scanResult.type} · {scanResult.id}</span><Link className="btn-primary" to={scanResult.url}>항목 열기</Link></div>}</Card>
    <Card className="card phase3-card"><h2>라벨 만들기</h2><div className="phase3-form-grid"><label>항목 종류<select className="form-input" value={type} onChange={(e) => { setType(e.target.value); setError(''); }}>{printableTypes.map((item) => <option key={item} value={item}>{typeLabels[item]}</option>)}</select></label>{type === 'lot' && <label>시약<select className="form-input" value={reagentForLots} onChange={(e) => setReagentForLots(e.target.value)}><option value="">시약 선택</option>{reagents.map((item) => <option key={recordId(item)} value={recordId(item)}>{item.name}</option>)}</select></label>}<label>항목<select className="form-input" multiple size="5" value={selectedIds} onChange={(e) => setSelectedIds(Array.from(e.target.selectedOptions, (option) => option.value))}>{records.map((record) => <option key={recordId(record)} value={recordId(record)}>{entityName(record)}{type === 'lot' ? ` · ${record.lotNumber}` : ''}</option>)}</select><small>여러 개를 선택할 수 있습니다. PDF/ZPL에는 항목 ID만 전송됩니다.</small></label><label>라벨 크기<select className="form-input" value={template} onChange={(e) => setTemplate(e.target.value)}>{templates.map((item) => <option key={item}>{item}</option>)}</select></label><label>PDF 시트<select className="form-input" value={sheet} onChange={(e) => setSheet(e.target.value)}>{templates.map((item) => <option key={item}>{item}</option>)}</select></label><label>시트 시작 칸<input className="form-input" type="number" min="0" value={startOffset} onChange={(e) => setStartOffset(e.target.value)} /></label><div className="phase3-form-actions"><button type="button" className="btn-primary" disabled={busy || !selectedRecords.length} onClick={downloadPdf}>PDF 다운로드</button><button type="button" className="btn-outline" disabled={busy || !selectedRecords.length} onClick={downloadZpl}>ZPL 다운로드</button></div></div>{previewRecord && <div className="label-preview"><h3>SVG 미리보기</h3>{previewUrl && <img src={previewUrl} alt={`${entityName(previewRecord)} 라벨 미리보기`} />}<p className="muted">미리보기는 선택한 서버 항목 정보를 사용합니다. 최종 파일은 서버가 DB에서 다시 읽어 생성합니다.</p></div>}</Card>
  </div>;
}
