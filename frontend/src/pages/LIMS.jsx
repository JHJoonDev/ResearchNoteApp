import { PageHeader, Card, StatStrip, StatusPill } from '../components/ui';
import '../styles/operations.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useAuthStore from '../store/useAuthStore';
import { api, errorMessage } from '../lib/api';
import { asList, recordId } from '../lib/phase3';
import { formatQuantity } from '../lib/display';

const emptyReceipt = () => ({ lotNumber: '', amount: '', supplierLot: '', expirationDate: '', receivedAt: '', locationId: '', location: '' });

export default function LIMS() {
  const { user } = useAuthStore();
  const [items, setItems] = useState([]);
  const [lots, setLots] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', brand: '', cas: '', lotNumber: '', amount: '', minimumStock: '0', unit: 'ea', expirationDate: '', location: '' });
  const [receipt, setReceipt] = useState(emptyReceipt);
  const [adjustingId, setAdjustingId] = useState('');
  const [adjustment, setAdjustment] = useState({ delta: '', reason: '' });
  const [editingLot, setEditingLot] = useState(null);

  const selected = useMemo(() => items.find((item) => recordId(item) === selectedId) || null, [items, selectedId]);
  const canWrite = user?.role !== 'viewer';

  const loadItems = useCallback(async (preferredId) => {
    const { data } = await api.get('/lims');
    const nextItems = asList(data);
    setItems(nextItems);
    setSelectedId((current) => {
      const candidate = preferredId || current;
      return nextItems.some((item) => recordId(item) === candidate) ? candidate : recordId(nextItems[0]);
    });
    return nextItems;
  }, []);

  const loadLots = useCallback(async (reagentId) => {
    if (!reagentId) {
      setLots([]);
      return;
    }
    const { data } = await api.get(`/lims/${encodeURIComponent(reagentId)}/lots`);
    setLots(asList(data));
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/lims'), api.get('/locations')])
      .then(([limsResponse, locationResponse]) => {
        if (!active) return;
        const nextItems = asList(limsResponse.data);
        setItems(nextItems);
        setSelectedId(recordId(nextItems[0]));
        setLocations(asList(locationResponse.data));
      })
      .catch((e) => active && setError(errorMessage(e)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setLots([]);
      return () => { active = false; };
    }
    api.get(`/lims/${encodeURIComponent(selectedId)}/lots`)
      .then(({ data }) => active && setLots(asList(data)))
      .catch((e) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [selectedId]);

  const run = async (action, successMessage) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const createItem = (event) => {
    event.preventDefault();
    run(async () => {
      const { data } = await api.post('/lims', {
        name: newItem.name.trim(), brand: newItem.brand.trim(), cas: newItem.cas.trim(),
        lotNumber: newItem.lotNumber.trim() || undefined, stockValue: Number(newItem.amount),
        minimumStock: Number(newItem.minimumStock || 0),
        unit: newItem.unit, expirationDate: newItem.expirationDate || undefined,
        location: newItem.location.trim() || undefined,
      });
      await loadItems(recordId(data));
      setNewItem({ name: '', brand: '', cas: '', lotNumber: '', amount: '', minimumStock: '0', unit: 'ea', expirationDate: '', location: '' });
      setShowCreate(false);
    }, '시약과 초기 LOT를 등록했습니다.');
  };

  const receiveLot = (event) => {
    event.preventDefault();
    if (!selected) return;
    run(async () => {
      await api.post(`/lims/${encodeURIComponent(recordId(selected))}/lots`, {
        lotNumber: receipt.lotNumber.trim(), amount: Number(receipt.amount),
        supplierLot: receipt.supplierLot.trim() || undefined,
        expirationDate: receipt.expirationDate || undefined,
        receivedAt: receipt.receivedAt || undefined,
        locationId: receipt.locationId || undefined,
        location: receipt.location.trim() || undefined,
      });
      await Promise.all([loadItems(recordId(selected)), loadLots(recordId(selected))]);
      setReceipt(emptyReceipt());
      setShowReceive(false);
    }, '입고 LOT를 등록했습니다.');
  };

  const adjustLot = (event, lot) => {
    event.preventDefault();
    run(async () => {
      await api.post(`/lims/lots/${encodeURIComponent(recordId(lot))}/adjust`, {
        delta: Number(adjustment.delta), reason: adjustment.reason.trim(), version: lot.version,
      });
      await Promise.all([loadItems(recordId(selected)), loadLots(recordId(selected))]);
      setAdjustingId('');
      setAdjustment({ delta: '', reason: '' });
    }, 'LOT 수량을 조정했습니다.');
  };

  const saveLot = (event) => {
    event.preventDefault();
    if (!editingLot) return;
    run(async () => {
      await api.put(`/lims/lots/${encodeURIComponent(recordId(editingLot))}`, {
        version: editingLot.version,
        ...(['사용가능', '폐기'].includes(editingLot.status) ? { status: editingLot.status } : {}),
        locationId: editingLot.locationId || null,
        location: editingLot.location || '',
        expirationDate: editingLot.expirationDate || null,
      });
      await Promise.all([loadItems(recordId(selected)), loadLots(recordId(selected))]);
      setEditingLot(null);
    }, 'LOT 정보를 저장했습니다.');
  };

  const itemOptions = items.map((item) => <option key={recordId(item)} value={recordId(item)}>{item.name}</option>);

  return (
    <div className="dashboard-content operations-page phase3-page">
      <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '재고·장비' }, { label: '시약 관리' }]} title="시약 LOT 재고" description="입고와 조정은 LOT 단위로 기록합니다. 총 재고는 LOT 잔량 합계입니다." actions={<>{canWrite && <div className="phase3-actions"><button className="btn-outline" onClick={() => setShowCreate((value) => !value)}>새 시약</button><button className="btn-primary" disabled={!selected} onClick={() => setShowReceive((value) => !value)}>입고 등록</button></div>}</>} />
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notice && <p className="notice-banner" role="status">{notice}</p>}

      <StatStrip items={[{ label: '시약', value: items.length }, { label: 'LOT 목록', value: lots.length }, { label: '현재 총 재고', value: selected ? `${formatQuantity(selected.stockValue)} ${selected.unit}` : '—' }, { label: '최소 재고 알림 기준', value: selected ? `${formatQuantity(selected.minimumStock || 0)} ${selected.unit}` : '—' }]} />
      {showCreate && canWrite && <Card className="card phase3-card"><h2>시약과 초기 LOT 등록</h2><form className="phase3-form-grid" onSubmit={createItem}>
        <label>시약명<input className="form-input" required value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} /></label>
        <label>제조사<input className="form-input" value={newItem.brand} onChange={(e) => setNewItem({ ...newItem, brand: e.target.value })} /></label>
        <label>CAS 번호<input className="form-input" value={newItem.cas} onChange={(e) => setNewItem({ ...newItem, cas: e.target.value })} /></label>
        <label>초기 LOT 번호<input className="form-input" placeholder="미입력 시 자동 생성" value={newItem.lotNumber} onChange={(e) => setNewItem({ ...newItem, lotNumber: e.target.value })} /></label>
        <label>수량<input className="form-input" type="number" min="0" step="any" required value={newItem.amount} onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })} /></label>
        <label>최소 재고 알림 기준<input className="form-input" type="number" min="0" step="any" value={newItem.minimumStock} onChange={(e) => setNewItem({ ...newItem, minimumStock: e.target.value })} /></label>
        <label>단위<select className="form-input" value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}>{['ea', 'mL', 'L', 'mg', 'g', 'kg'].map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        <label>유효기한<input className="form-input" type="date" value={newItem.expirationDate} onChange={(e) => setNewItem({ ...newItem, expirationDate: e.target.value })} /></label>
        <label>보관 위치<input className="form-input" placeholder="선택 입력" value={newItem.location} onChange={(e) => setNewItem({ ...newItem, location: e.target.value })} /></label>
        <div className="phase3-form-actions"><button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>취소</button><button className="btn-primary" disabled={busy}>{busy ? '저장 중…' : '시약 등록'}</button></div>
      </form></Card>}

      {showReceive && selected && <Card className="card phase3-card"><h2>{selected.name} 입고</h2><form className="phase3-form-grid" onSubmit={receiveLot}>
        <label>LOT 번호<input className="form-input" required value={receipt.lotNumber} onChange={(e) => setReceipt({ ...receipt, lotNumber: e.target.value })} /></label>
        <label>입고 수량<input className="form-input" type="number" min="0.000001" step="any" required value={receipt.amount} onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })} /></label>
        <label>공급사 LOT<input className="form-input" value={receipt.supplierLot} onChange={(e) => setReceipt({ ...receipt, supplierLot: e.target.value })} /></label>
        <label>입고일<input className="form-input" type="date" value={receipt.receivedAt} onChange={(e) => setReceipt({ ...receipt, receivedAt: e.target.value })} /></label>
        <label>유효기한<input className="form-input" type="date" value={receipt.expirationDate} onChange={(e) => setReceipt({ ...receipt, expirationDate: e.target.value })} /></label>
        <label>위치 트리<select className="form-input" value={receipt.locationId} onChange={(e) => setReceipt({ ...receipt, locationId: e.target.value })}><option value="">위치 선택 안 함</option>{locations.map((location) => <option key={recordId(location)} value={recordId(location)}>{location.name}</option>)}</select></label>
        {!receipt.locationId && <label>자유 입력 위치<input className="form-input" value={receipt.location} onChange={(e) => setReceipt({ ...receipt, location: e.target.value })} /></label>}
        <div className="phase3-form-actions"><button type="button" className="btn-secondary" onClick={() => setShowReceive(false)}>취소</button><button className="btn-primary" disabled={busy}>{busy ? '저장 중…' : '입고 등록'}</button></div>
      </form></Card>}

      <Card className="card phase3-card phase3-toolbar">
        <label>시약 선택<select className="form-input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">시약 선택</option>{itemOptions}</select></label>
        {selected && <div className="inventory-total"><span>현재 총 재고</span><strong>{formatQuantity(selected.stockValue)} {selected.unit}</strong></div>}
      </Card>

      <Card className="card phase3-card">
        <div className="card-header"><h2>LOT 목록</h2><span className="muted">{lots.length}개</span></div>
        {loading ? <p className="empty-state">재고를 불러오는 중…</p> : !selected ? <p className="empty-state">등록된 시약이 없습니다.</p> : !lots.length ? <p className="empty-state">LOT이 없습니다.</p> : <div className="table-scroll"><table className="data-table ui-table"><thead><tr><th>시약</th><th>LOT</th><th>공급사 LOT</th><th>잔량</th><th>입고일</th><th>유효기한</th><th>상태</th><th>위치</th>{canWrite && <th>작업</th>}</tr></thead><tbody>{lots.map((lot) => {
          const id = recordId(lot);
          const expired = lot.expirationDate && new Date(lot.expirationDate) < new Date(new Date().toDateString());
          const status = expired ? '만료' : lot.status || '사용가능';
          const unusable = ['소진', '폐기', '만료'].includes(status);
          return <tr key={id}><td>{selected.name}</td><td className="operations-mono"><strong>{lot.lotNumber}</strong></td><td>{lot.supplierLot || '—'}</td><td className="ui-num">{formatQuantity(lot.remainingAmount)} {lot.unit || selected.unit}</td><td className="operations-mono">{lot.receivedAt ? new Date(lot.receivedAt).toLocaleDateString() : '—'}</td><td className="operations-mono">{lot.expirationDate ? new Date(lot.expirationDate).toLocaleDateString() : '—'}</td><td><StatusPill tone={unusable ? 'danger' : 'success'}>{status}</StatusPill></td><td>{lot.location || locations.find((location) => recordId(location) === lot.locationId)?.name || '—'}</td>{canWrite && <td><div className="phase3-row-actions operations-lot-actions"><button className="btn-ghost btn-small" onClick={() => { setAdjustingId(id); setEditingLot(null); }}>수량 조정</button><button className="btn-ghost btn-small" onClick={() => { setEditingLot({ ...lot }); setAdjustingId(''); }}>수정</button></div></td>}</tr>;
        })}</tbody></table></div>}
        {adjustingId && <form className="phase3-inline-form" onSubmit={(event) => adjustLot(event, lots.find((lot) => recordId(lot) === adjustingId))}><h3>LOT 수량 조정</h3><label>증감량 (+/-)<input className="form-input" type="number" step="any" required value={adjustment.delta} onChange={(e) => setAdjustment({ ...adjustment, delta: e.target.value })} /></label><label>사유<input className="form-input" required value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} /></label><button className="btn-primary" disabled={busy}>조정 저장</button><button type="button" className="btn-secondary" onClick={() => setAdjustingId('')}>취소</button></form>}
        {editingLot && <form className="phase3-inline-form" onSubmit={saveLot}><h3>LOT 정보 수정</h3>{['사용가능', '폐기'].includes(editingLot.status) && <label>상태<select className="form-input" value={editingLot.status} onChange={(e) => setEditingLot({ ...editingLot, status: e.target.value })}><option value="사용가능">사용가능</option><option value="폐기">폐기</option></select></label>}{['소진', '만료'].includes(editingLot.status) && <p className="muted">상태는 수량과 유효기한에 따라 서버가 계산합니다: {editingLot.status}</p>}<label>위치 트리<select className="form-input" value={editingLot.locationId || ''} onChange={(e) => setEditingLot({ ...editingLot, locationId: e.target.value, location: '' })}><option value="">트리 위치 없음</option>{locations.map((location) => <option key={recordId(location)} value={recordId(location)}>{location.name}</option>)}</select></label><label>자유 입력 위치<input className="form-input" value={editingLot.location || ''} onChange={(e) => setEditingLot({ ...editingLot, location: e.target.value, locationId: '' })} /></label><label>유효기한<input className="form-input" type="date" value={editingLot.expirationDate ? String(editingLot.expirationDate).slice(0, 10) : ''} onChange={(e) => setEditingLot({ ...editingLot, expirationDate: e.target.value })} /></label><button className="btn-primary" disabled={busy}>변경 저장</button><button type="button" className="btn-secondary" onClick={() => setEditingLot(null)}>취소</button></form>}
      </Card>
    </div>
  );
}
