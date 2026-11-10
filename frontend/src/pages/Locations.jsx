import { PageHeader, Card } from '../components/ui';
import { Grid2X2, MapPin, Trash2 } from 'lucide-react';
import '../styles/operations.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { asList, entityName, recordId } from '../lib/phase3';

const kinds = ['room', 'freezer', 'shelf', 'box', 'other'];
const kindLabel = { room: '실험실', freezer: '냉동고', shelf: '선반', box: '박스', other: '기타' };
const blankForm = () => ({ name: '', kind: 'room', parentId: '', rows: 5, cols: 5 });

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [entities, setEntities] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(blankForm);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = useMemo(() => locations.find((location) => recordId(location) === selectedId), [locations, selectedId]);

  const reload = useCallback(async () => {
    const loadEntities = async () => {
      const all = [];
      const limit = 100;
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const { data } = await api.get('/entities', { params: { page, limit } });
        const items = asList(data);
        all.push(...items);
        if (Array.isArray(data)) break;
        total = Number.isFinite(Number(data?.total)) ? Number(data.total) : all.length + (items.length === limit ? 1 : 0);
        if (!items.length || items.length < limit || all.length >= total) break;
        page += 1;
      }
      return all;
    };
    const [locationResponse, allEntities] = await Promise.all([
      api.get('/locations'),
      loadEntities().catch(() => []),
    ]);
    const next = asList(locationResponse.data).filter((location) => !location.isDeleted);
    setLocations(next);
    setEntities(allEntities);
    setSelectedId((current) => next.some((location) => recordId(location) === current) ? current : recordId(next[0]));
  }, []);

  useEffect(() => { reload().catch((e) => setError(errorMessage(e))); }, [reload]);

  const childrenOf = (parentId) => locations.filter((location) => String(location.parentId || '') === String(parentId || ''));
  const descendantsOf = (id, found = new Set()) => {
    for (const child of childrenOf(id)) {
      const childId = recordId(child);
      if (!found.has(childId)) {
        found.add(childId);
        descendantsOf(childId, found);
      }
    }
    return found;
  };
  const tree = (parentId = '', depth = 0) => childrenOf(parentId).map((location) => (
    <div key={recordId(location)}>
      <button className={`location-tree-item ${selectedId === recordId(location) ? 'active' : ''}`} style={{ paddingLeft: `${0.75 + depth * 1.15}rem` }} onClick={() => setSelectedId(recordId(location))}>
        <span aria-hidden="true">{location.kind === 'box' ? <Grid2X2 /> : <MapPin />}</span><span className="location-tree-name">{location.name}</span><small>{kindLabel[location.kind] || location.kind}</small>
      </button>
      {tree(recordId(location), depth + 1)}
    </div>
  ));

  const beginAdd = () => { setForm({ ...blankForm(), parentId: selectedId }); setAdding(true); setEditing(false); };
  const beginEdit = () => {
    if (!selected) return;
    setForm({ name: selected.name, kind: selected.kind, parentId: selected.parentId || '', rows: selected.grid?.rows || 5, cols: selected.grid?.cols || 5 });
    setAdding(false);
    setEditing(true);
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    const body = { name: form.name.trim(), kind: form.kind, parentId: form.parentId || null, grid: form.kind === 'box' ? { rows: Number(form.rows), cols: Number(form.cols) } : null };
    try {
      const { data } = adding ? await api.post('/locations', body) : await api.put(`/locations/${encodeURIComponent(selectedId)}`, body);
      await reload();
      if (adding && data) setSelectedId(recordId(data));
      setAdding(false); setEditing(false); setNotice(adding ? '보관 위치를 등록했습니다.' : '보관 위치를 수정했습니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selected || !window.confirm(`“${selected.name}” 위치를 삭제할까요?`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await api.delete(`/locations/${encodeURIComponent(selectedId)}`); await reload(); setNotice('보관 위치를 삭제했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const blockedParentIds = editing ? descendantsOf(selectedId, new Set([selectedId])) : new Set();
  const occupied = new Map(entities.filter((entity) => String(entity.locationId || '') === selectedId && entity.position).map((entity) => [`${entity.position.row}:${entity.position.col}`, entity]));

  return <div className="dashboard-content operations-page phase3-page">
    <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '재고·장비' }, { label: '보관 위치' }]} title="보관 위치" description="위치 트리를 구성하고 박스의 칸별 점유 상태를 확인합니다." actions={<><div className="phase3-actions"><button className="btn-primary" onClick={beginAdd}>위치 추가</button>{selected && <><button className="btn-outline" onClick={beginEdit}>수정</button><button className="btn-ghost operations-danger" aria-label="삭제" title="삭제" disabled={busy} onClick={remove}><Trash2 aria-hidden="true" /></button></>}</div></>} />
    {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status" className="notice-banner">{notice}</p>}
    <div className="location-layout">
      <Card className="card phase3-card location-tree"><h2>위치 트리</h2>{locations.length ? tree() : <p className="muted">등록된 위치가 없습니다.</p>}</Card>
      <Card className="card phase3-card location-detail">
        {(adding || editing) ? <form className="phase3-form-grid" onSubmit={save}><h2>{adding ? '위치 추가' : '위치 수정'}</h2><label>이름<input className="form-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>종류<select className="form-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{kinds.map((kind) => <option key={kind} value={kind}>{kindLabel[kind]}</option>)}</select></label><label>상위 위치<select className="form-input" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}><option value="">최상위</option>{locations.filter((location) => !blockedParentIds.has(recordId(location))).map((location) => <option key={recordId(location)} value={recordId(location)}>{location.name}</option>)}</select></label>{form.kind === 'box' && <><label>행 수<input className="form-input" type="number" min="1" max="100" value={form.rows} onChange={(e) => setForm({ ...form, rows: e.target.value })} /></label><label>열 수<input className="form-input" type="number" min="1" max="100" value={form.cols} onChange={(e) => setForm({ ...form, cols: e.target.value })} /></label></>}<div className="phase3-form-actions"><button type="button" className="btn-secondary" onClick={() => { setAdding(false); setEditing(false); }}>취소</button><button className="btn-primary" disabled={busy}>{busy ? '저장 중…' : '저장'}</button></div></form> : selected ? <><div className="card-header"><div><p className="eyebrow">{kindLabel[selected.kind] || selected.kind}</p><h2>{selected.name}</h2></div></div><dl className="phase3-definition"><div><dt>상위 위치</dt><dd>{locations.find((location) => recordId(location) === String(selected.parentId || ''))?.name || '최상위'}</dd></div><div><dt>종류</dt><dd>{kindLabel[selected.kind] || selected.kind}</dd></div><div><dt>보관 중인 개체</dt><dd>{entities.filter((entity) => String(entity.locationId || '') === selectedId).length}</dd></div></dl>{selected.kind === 'box' && selected.grid && <><h3>박스 칸 배치</h3><div className="location-grid" style={{ '--grid-cols': selected.grid.cols }}>{Array.from({ length: selected.grid.rows * selected.grid.cols }, (_, index) => { const row = Math.floor(index / selected.grid.cols) + 1; const col = index % selected.grid.cols + 1; const entity = occupied.get(`${row}:${col}`); return <div key={index} className={`location-cell ${entity ? 'occupied' : ''}`} title={entity ? entityName(entity) : '비어 있음'}><strong>{row},{col}</strong><span>{entity ? entityName(entity) : '비어 있음'}</span></div>; })}</div></>}</> : <p className="empty-state">위치를 선택하거나 새 위치를 등록하세요.</p>}
      </Card>
    </div>
  </div>;
}
