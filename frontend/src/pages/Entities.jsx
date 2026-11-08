import { useCallback, useEffect, useMemo, useState } from 'react';
import useAuthStore from '../store/useAuthStore';
import { api, errorMessage } from '../lib/api';
import { asList, entityName, recordId } from '../lib/phase3';

const fieldKinds = ['text', 'number', 'date', 'select'];
const entityKinds = ['sample', 'equipment', 'other'];
const kindNames = { sample: '샘플', equipment: '장비', other: '기타' };
const blankField = () => ({ id: '', name: '', kind: 'text', options: [], required: false });
const blankType = () => ({ name: '', kind: 'sample', fields: [blankField()] });
const blankEntity = () => ({ typeId: '', code: '', name: '', values: {}, projectId: '', locationId: '', row: '', col: '', status: 'active', calibrationDueAt: '' });
const responseList = (data) => asList(data);

export default function Entities() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState('entities');
  const [types, setTypes] = useState([]);
  const [entities, setEntities] = useState([]);
  const [locations, setLocations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [typeForm, setTypeForm] = useState(null);
  const [entityForm, setEntityForm] = useState(null);
  const [bookingForm, setBookingForm] = useState({ start: '', end: '', purpose: '' });
  const canWrite = user?.role !== 'viewer';
  const isAdmin = user?.role === 'admin';
  const entityTypeMap = useMemo(() => new Map(types.map((type) => [recordId(type), type])), [types]);

  const loadEntities = useCallback(async (nextPage = 1, nextQuery = '', nextType = '', nextProject = '') => {
    const params = { page: nextPage, limit: 20 };
    if (nextQuery.trim()) params.q = nextQuery.trim();
    if (nextType) params.typeId = nextType;
    if (nextProject) params.projectId = nextProject;
    const { data } = await api.get('/entities', { params });
    setEntities(responseList(data));
    setTotal(Array.isArray(data) ? data.length : Number(data.total || 0));
    setPage(Number(data.page || nextPage));
  }, []);

  const reloadMeta = useCallback(async () => {
    const [typeResponse, locationResponse, projectResponse, alertResponse] = await Promise.all([
      api.get('/entity-types'), api.get('/locations'), api.get('/projects'), api.get('/equipment/alerts').catch(() => ({ data: [] })),
    ]);
    setTypes(responseList(typeResponse.data));
    setLocations(responseList(locationResponse.data).filter((location) => !location.isDeleted));
    setProjects(responseList(projectResponse.data));
    setAlerts(responseList(alertResponse.data));
  }, []);

  useEffect(() => {
    Promise.all([reloadMeta(), loadEntities(1, '', '')]).catch((e) => setError(errorMessage(e)));
  }, [reloadMeta, loadEntities]);

  const loadBookings = useCallback(async (entity) => {
    if (!entity || entityTypeMap.get(String(entity.typeId))?.kind !== 'equipment') { setBookings([]); return; }
    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 90);
    const { data } = await api.get(`/entities/${encodeURIComponent(recordId(entity))}/bookings`, { params: { from: from.toISOString(), to: to.toISOString() } });
    setBookings(responseList(data));
  }, [entityTypeMap]);

  const openEntity = async (entity) => {
    setError('');
    try {
      const { data } = await api.get(`/entities/${encodeURIComponent(recordId(entity))}`);
      setSelected(data);
      await loadBookings(data);
    } catch (e) { setSelected(entity); setError(errorMessage(e)); }
  };

  const beginType = (type = null) => setTypeForm(type ? {
    ...type,
    fields: (type.fields || []).map((field) => ({ ...field, options: field.options || [] })),
  } : blankType());

  const saveType = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    const body = { name: typeForm.name.trim(), kind: typeForm.kind, fields: typeForm.fields.map((field) => ({
      ...(field.id ? { id: field.id } : {}), name: field.name.trim(), kind: field.kind,
      options: field.kind === 'select' ? field.options : [], required: Boolean(field.required),
    })) };
    try {
      if (typeForm.id || typeForm._id) await api.put(`/entity-types/${encodeURIComponent(recordId(typeForm))}`, body);
      else await api.post('/entity-types', body);
      setTypeForm(null); await reloadMeta(); setNotice('개체 유형을 저장했습니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const deleteType = async (type) => {
    if (!window.confirm(`“${type.name}” 유형을 삭제할까요?`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await api.delete(`/entity-types/${encodeURIComponent(recordId(type))}`); await reloadMeta(); setNotice('개체 유형을 삭제했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const beginEntity = (entity = null) => {
    const typeId = entity?.typeId || typeFilter || recordId(types[0]);
    setSelected(entity || null);
    setEntityForm(entity ? {
      ...blankEntity(), ...entity, typeId: String(entity.typeId || typeId), values: { ...(entity.values || {}) },
      row: entity.position?.row ?? '', col: entity.position?.col ?? '', calibrationDueAt: entity.calibrationDueAt ? String(entity.calibrationDueAt).slice(0, 10) : '',
    } : { ...blankEntity(), typeId: String(typeId), locationId: recordId(locations[0]) });
  };

  const saveEntity = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    const position = entityForm.row !== '' && entityForm.col !== '' ? { row: Number(entityForm.row), col: Number(entityForm.col) } : null;
    const body = {
      typeId: entityForm.typeId, code: entityForm.code.trim(), name: entityForm.name.trim(), values: entityForm.values,
      projectId: entityForm.projectId || null, locationId: entityForm.locationId,
      ...(position ? { position } : {}), status: entityForm.status,
      ...(entityTypeMap.get(String(entityForm.typeId))?.kind === 'equipment' ? { calibrationDueAt: entityForm.calibrationDueAt || null } : {}),
    };
    try {
      if (entityForm.id || entityForm._id) await api.put(`/entities/${encodeURIComponent(recordId(entityForm))}`, body);
      else await api.post('/entities', body);
      setEntityForm(null); setPage(1); await loadEntities(1, query, typeFilter, projectFilter); setNotice('개체를 저장했습니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const deleteEntity = async (entity) => {
    if (!window.confirm(`“${entityName(entity)}” 개체를 삭제할까요?`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await api.delete(`/entities/${encodeURIComponent(recordId(entity))}`); setSelected(null); await loadEntities(1, query, typeFilter, projectFilter); setNotice('개체를 삭제했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const createBooking = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`/entities/${encodeURIComponent(recordId(selected))}/bookings`, { start: new Date(bookingForm.start).toISOString(), end: new Date(bookingForm.end).toISOString(), purpose: bookingForm.purpose.trim() });
      await loadBookings(selected); setBookingForm({ start: '', end: '', purpose: '' }); setNotice('장비 예약을 등록했습니다.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const cancelBooking = async (booking) => {
    setBusy(true); setError('');
    try { await api.delete(`/bookings/${encodeURIComponent(recordId(booking))}`); await loadBookings(selected); setNotice('예약을 취소했습니다.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const updateTypeField = (index, changes) => setTypeForm((current) => ({ ...current, fields: current.fields.map((field, i) => i === index ? { ...field, ...changes } : field) }));
  const updateFieldValue = (fieldId, value) => setEntityForm((current) => ({ ...current, values: { ...current.values, [fieldId]: value } }));
  const currentType = entityForm ? entityTypeMap.get(String(entityForm.typeId)) : null;
  const location = locations.find((item) => recordId(item) === String(entityForm?.locationId || ''));
  const isEquipment = currentType?.kind === 'equipment';

  return <div className="dashboard-content phase3-page">
    <div className="phase3-heading"><div><p className="eyebrow">SAMPLES & EQUIPMENT</p><h1 className="page-title">샘플·장비 관리</h1><p className="muted">개체 유형, 보관 위치, 예약과 교정 알림을 관리합니다.</p></div><div className="phase3-actions">{tab === 'entities' && canWrite && <button className="btn-primary" disabled={!types.length} onClick={() => beginEntity()}>개체 등록</button>}{tab === 'types' && isAdmin && <button className="btn-primary" onClick={() => beginType()}>유형 추가</button>}</div></div>
    {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status" className="notice-banner">{notice}</p>}
    <div className="phase3-tabs" role="tablist"><button role="tab" aria-selected={tab === 'entities'} className={tab === 'entities' ? 'active' : ''} onClick={() => setTab('entities')}>개체 목록</button><button role="tab" aria-selected={tab === 'types'} className={tab === 'types' ? 'active' : ''} onClick={() => setTab('types')}>유형 관리</button><button role="tab" aria-selected={tab === 'equipment'} className={tab === 'equipment' ? 'active' : ''} onClick={() => setTab('equipment')}>장비 알림</button></div>

    {tab === 'entities' && <section className="card phase3-card"><div className="phase3-toolbar"><label>유형<select className="form-input" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); loadEntities(1, query, e.target.value, projectFilter).catch((err) => setError(errorMessage(err))); }}><option value="">전체 유형</option>{types.map((type) => <option key={recordId(type)} value={recordId(type)}>{type.name}</option>)}</select></label><label>프로젝트<select className="form-input" value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPage(1); loadEntities(1, query, typeFilter, e.target.value).catch((err) => setError(errorMessage(err))); }}><option value="">전체 프로젝트</option>{projects.map((project) => <option key={recordId(project)} value={recordId(project)}>{project.name}</option>)}</select></label><form className="phase3-search" onSubmit={(e) => { e.preventDefault(); setPage(1); loadEntities(1, query, typeFilter, projectFilter).catch((err) => setError(errorMessage(err))); }}><input className="form-input" placeholder="코드, 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="btn-outline">검색</button></form></div>
      {entities.length ? <div className="entity-list">{entities.map((entity) => <button className={`entity-row ${recordId(selected) === recordId(entity) ? 'active' : ''}`} key={recordId(entity)} onClick={() => openEntity(entity)}><span className="entity-mark">{entityTypeMap.get(String(entity.typeId))?.kind === 'equipment' ? '⚙' : '▣'}</span><span><strong>{entity.name}</strong><small>{entity.code} · {entityTypeMap.get(String(entity.typeId))?.name || '유형'}</small></span><span className="muted">{entity.status || 'active'}</span></button>)}</div> : <p className="empty-state">개체가 없습니다.</p>}
      <div className="phase3-pagination"><span>{total}개</span><div><button className="btn-small" disabled={page <= 1} onClick={() => loadEntities(page - 1, query, typeFilter, projectFilter).catch((e) => setError(errorMessage(e)))}>이전</button><span>{page} / {Math.max(1, Math.ceil(total / 20))}</span><button className="btn-small" disabled={page * 20 >= total} onClick={() => loadEntities(page + 1, query, typeFilter, projectFilter).catch((e) => setError(errorMessage(e)))}>다음</button></div></div>
      {selected && !entityForm && <div className="entity-detail"><div className="card-header"><div><p className="eyebrow">{entityTypeMap.get(String(selected.typeId))?.name || '개체'}</p><h2>{selected.name}</h2><p className="muted">{selected.code} · {selected.status || 'active'}</p></div>{canWrite && <div className="phase3-row-actions"><button className="btn-outline" onClick={() => beginEntity(selected)}>수정</button><button className="btn-danger" disabled={busy} onClick={() => deleteEntity(selected)}>삭제</button></div>}</div><dl className="phase3-definition"><div><dt>위치</dt><dd>{locations.find((item) => recordId(item) === String(selected.locationId || ''))?.name || '—'}</dd></div><div><dt>프로젝트</dt><dd>{projects.find((item) => recordId(item) === String(selected.projectId || ''))?.name || '공용'}</dd></div>{Object.entries(selected.values || {}).map(([key, value]) => <div key={key}><dt>{currentType?.fields?.find((field) => field.id === key)?.name || key}</dt><dd>{String(value)}</dd></div>)}</dl>{entityTypeMap.get(String(selected.typeId))?.kind === 'equipment' && <BookingPanel bookings={bookings} busy={busy} form={bookingForm} setForm={setBookingForm} onSubmit={createBooking} onCancel={cancelBooking} canWrite={canWrite} />}</div>}
      {entityForm && <form className="card phase3-card phase3-form-grid" onSubmit={saveEntity}><h2>{entityForm.id || entityForm._id ? '개체 수정' : '개체 등록'}</h2><label>유형<select required className="form-input" value={entityForm.typeId} disabled={Boolean(entityForm.id || entityForm._id)} onChange={(e) => setEntityForm({ ...entityForm, typeId: e.target.value, values: {} })}>{types.map((type) => <option key={recordId(type)} value={recordId(type)}>{type.name}</option>)}</select></label><label>코드<input className="form-input" required value={entityForm.code} onChange={(e) => setEntityForm({ ...entityForm, code: e.target.value })} /></label><label>이름<input className="form-input" required value={entityForm.name} onChange={(e) => setEntityForm({ ...entityForm, name: e.target.value })} /></label><label>프로젝트<select className="form-input" value={entityForm.projectId || ''} onChange={(e) => setEntityForm({ ...entityForm, projectId: e.target.value })}><option value="">공용</option>{projects.map((project) => <option key={recordId(project)} value={recordId(project)}>{project.name}</option>)}</select></label><label>보관 위치<select required className="form-input" value={entityForm.locationId || ''} onChange={(e) => setEntityForm({ ...entityForm, locationId: e.target.value, row: '', col: '' })}><option value="">위치 선택</option>{locations.map((item) => <option key={recordId(item)} value={recordId(item)}>{item.name}</option>)}</select></label>{location?.kind === 'box' && <><label>행<input className="form-input" type="number" min="1" max={location.grid?.rows || 100} value={entityForm.row} onChange={(e) => setEntityForm({ ...entityForm, row: e.target.value })} /></label><label>열<input className="form-input" type="number" min="1" max={location.grid?.cols || 100} value={entityForm.col} onChange={(e) => setEntityForm({ ...entityForm, col: e.target.value })} /></label></>}{currentType?.fields?.map((field) => <label key={field.id}>{field.name}{field.required ? ' *' : ''}{field.kind === 'select' ? <select className="form-input" required={field.required} value={entityForm.values[field.id] ?? ''} onChange={(e) => updateFieldValue(field.id, e.target.value)}><option value="">선택</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input className="form-input" type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'} required={field.required} value={entityForm.values[field.id] ?? ''} onChange={(e) => updateFieldValue(field.id, field.kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />}</label>)}<label>상태<select className="form-input" value={entityForm.status} onChange={(e) => setEntityForm({ ...entityForm, status: e.target.value })}>{['active', 'in_use', 'retired'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>{isEquipment && <label>교정 예정일<input className="form-input" type="date" value={entityForm.calibrationDueAt} onChange={(e) => setEntityForm({ ...entityForm, calibrationDueAt: e.target.value })} /></label>}<div className="phase3-form-actions"><button type="button" className="btn-secondary" onClick={() => setEntityForm(null)}>취소</button><button className="btn-primary" disabled={busy}>{busy ? '저장 중…' : '저장'}</button></div></form>}
    </section>}

    {tab === 'types' && <section className="card phase3-card"><h2>개체 유형</h2>{typeForm && isAdmin && <form className="phase3-form-grid phase3-type-form" onSubmit={saveType}><label>유형 이름<input required className="form-input" value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} /></label><label>분류<select className="form-input" value={typeForm.kind} onChange={(e) => setTypeForm({ ...typeForm, kind: e.target.value })}>{entityKinds.map((kind) => <option key={kind} value={kind}>{kindNames[kind]}</option>)}</select></label><div className="phase3-field-list"><h3>사용자 지정 필드</h3>{typeForm.fields.map((field, index) => <div className="phase3-field-row" key={field.id || `new-${index}`}><input className="form-input" aria-label="필드 이름" placeholder="필드 이름" required value={field.name} onChange={(e) => updateTypeField(index, { name: e.target.value })} /><select className="form-input" aria-label="필드 종류" value={field.kind} onChange={(e) => updateTypeField(index, { kind: e.target.value, options: e.target.value === 'select' ? field.options : [] })}>{fieldKinds.map((kind) => <option key={kind}>{kind}</option>)}</select>{field.kind === 'select' && <input className="form-input" aria-label="선택지" placeholder="선택지를 쉼표로 구분" value={(field.options || []).join(', ')} onChange={(e) => updateTypeField(index, { options: e.target.value.split(',').map((option) => option.trim()).filter(Boolean) })} />}<label className="checkbox-inline"><input type="checkbox" checked={Boolean(field.required)} onChange={(e) => updateTypeField(index, { required: e.target.checked })} /> 필수</label><button type="button" className="btn-small" aria-label="필드 제거" onClick={() => setTypeForm({ ...typeForm, fields: typeForm.fields.filter((_, i) => i !== index) })}>삭제</button></div>)}<button type="button" className="btn-outline" onClick={() => setTypeForm({ ...typeForm, fields: [...typeForm.fields, blankField()] })}>필드 추가</button></div><div className="phase3-form-actions"><button type="button" className="btn-secondary" onClick={() => setTypeForm(null)}>취소</button><button className="btn-primary" disabled={busy}>유형 저장</button></div></form>}{types.map((type) => <div className="entity-type-row" key={recordId(type)}><div><strong>{type.name}</strong><small>{kindNames[type.kind] || type.kind} · {(type.fields || []).length}개 필드</small></div>{isAdmin && <div className="phase3-row-actions"><button className="btn-small" onClick={() => beginType(type)}>수정</button><button className="btn-small" onClick={() => deleteType(type)}>삭제</button></div>}</div>)}{!types.length && <p className="empty-state">등록된 유형이 없습니다.</p>}</section>}

    {tab === 'equipment' && <section className="card phase3-card"><h2>30일 이내 교정 알림</h2>{alerts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>장비</th><th>코드</th><th>교정 예정일</th><th>위치</th></tr></thead><tbody>{alerts.map((alert) => <tr key={recordId(alert)}><td>{alert.name || alert.entity?.name}</td><td>{alert.code || alert.entity?.code}</td><td>{alert.calibrationDueAt ? new Date(alert.calibrationDueAt).toLocaleDateString() : '—'}</td><td>{locations.find((item) => recordId(item) === String(alert.locationId || alert.entity?.locationId || ''))?.name || '—'}</td></tr>)}</tbody></table></div> : <p className="empty-state">예정된 교정 알림이 없습니다.</p>}<h2>예약 관리</h2><p className="muted">개체 목록에서 장비를 선택해 예약 일정을 확인하고 등록할 수 있습니다.</p></section>}
  </div>;
}

function BookingPanel({ bookings, busy, form, setForm, onSubmit, onCancel, canWrite }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(today);
    day.setDate(day.getDate() + index);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    return { day, reservations: bookings.filter((booking) => new Date(booking.start) < nextDay && new Date(booking.end) > day) };
  });
  return <section className="booking-panel"><h3>장비 예약 일정</h3>{canWrite && <form className="phase3-form-grid" onSubmit={onSubmit}><label>시작<input required className="form-input" type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label><label>종료<input required className="form-input" type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label><label>목적<input required className="form-input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label><button className="btn-primary" disabled={busy}>예약 등록</button></form>}<div className="booking-calendar" aria-label="향후 14일 예약 일정">{days.map(({ day, reservations }) => <div className={`booking-day ${day.getTime() === today.getTime() ? 'today' : ''}`} key={day.toISOString()}><strong>{day.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })}</strong>{reservations.map((booking) => <span key={recordId(booking)} title={`${booking.purpose} · ${booking.userName || booking.userId}`}>{new Date(booking.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {booking.purpose}</span>)}</div>)}</div>{bookings.length ? bookings.map((booking) => <div className="booking-row" key={recordId(booking)}><span><strong>{new Date(booking.start).toLocaleString()}–{new Date(booking.end).toLocaleTimeString()}</strong><small>{booking.purpose} · {booking.userName || booking.userId}</small></span><button className="btn-small" disabled={busy} onClick={() => onCancel(booking)}>예약 취소</button></div>) : <p className="muted">표시 기간 내 예약이 없습니다.</p>}</section>;
}
