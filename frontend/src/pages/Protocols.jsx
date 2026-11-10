import { lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import useProjectStore from '../store/useProjectStore';
import Modal from '../components/Modal';
import { api, errorMessage } from '../lib/api';
import AiStatusContext from '../contexts/AiStatusContext';
import { Plus, ListChecks, Archive } from 'lucide-react';
import { PageHeader, Card, StatusPill, EmptyState } from '../components/ui';
import '../styles/records.css';

const newStep = () => ({ id: crypto.randomUUID(), title: '', instructions: '', checklist: [], resultFields: [] });
const newProtocol = () => ({ title: '', description: '', projectId: '', steps: [newStep()] });
const AiProtocolGenerator = lazy(() => import('../components/ai/AiProtocolGenerator.jsx'));

export default function Protocols() {
  const { projects, fetchProjects } = useProjectStore();
  const aiStatus = useContext(AiStatusContext);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(null);
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await api.get('/protocols');
    setItems(Array.isArray(data) ? data : data.items || []);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    fetchProjects();
  }, [load, fetchProjects]);

  const changeStep = (index, changes) => setForm((current) => ({
    ...current,
    steps: current.steps.map((step, i) => i === index ? { ...step, ...changes } : step),
  }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        projectId: form.projectId || null,
        steps: form.steps.map((step) => ({
          ...step,
          title: step.title.trim(),
          instructions: step.instructions.trim(),
          checklist: step.checklist.filter((item) => item.text.trim()),
          resultFields: step.resultFields.filter((field) => field.name.trim()),
        })),
      };
      if (form.id || form._id) await api.put(`/protocols/${form.id || form._id}`, payload);
      else await api.post('/protocols', payload);
      setForm(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const publish = async (item) => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/protocols/${item.id || item._id}/publish`, {});
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const showVersions = async (item) => {
    setError('');
    try {
      const { data } = await api.get(`/protocols/${item.id || item._id}/versions`);
      setVersions(data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async (item) => {
    if (!window.confirm('프로토콜을 보관 처리할까요?')) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/protocols/${item.id || item._id}`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const setChecklist = (stepIndex, textValue) => {
    const checklist = textValue.split('\n').map((text, i) => ({
      id: form.steps[stepIndex].checklist[i]?.id || crypto.randomUUID(),
      text,
    }));
    changeStep(stepIndex, { checklist });
  };
  const setResultFields = (stepIndex, textValue) => {
    const resultFields = textValue.split('\n').map((line, i) => {
      const [name = '', unit = '', kind = 'text'] = line.split('|');
      return {
        id: form.steps[stepIndex].resultFields[i]?.id || crypto.randomUUID(),
        name,
        unit,
        kind: kind === 'number' ? 'number' : 'text',
      };
    });
    changeStep(stepIndex, { resultFields });
  };
  const openAiDraft = (draft) => {
    const safetyNotes = Array.isArray(draft.safetyNotes) ? draft.safetyNotes.filter(Boolean) : [];
    const steps = (Array.isArray(draft.steps) ? draft.steps : []).map((step) => ({
      id: crypto.randomUUID(),
      title: step.title || '',
      instructions: step.instructions || '',
      checklist: (step.checklist || []).map((text) => ({ id: crypto.randomUUID(), text })),
      resultFields: (step.resultFields || []).map((field) => ({
        id: crypto.randomUUID(),
        name: field.name || '',
        unit: field.unit || '',
        kind: field.kind === 'number' ? 'number' : 'text',
      })),
    }));
    setForm({
      title: draft.title || '',
      description: safetyNotes.length ? `AI 안전 유의사항(검토 필요):\n${safetyNotes.map((item) => `• ${item}`).join('\n')}` : '',
      projectId: '',
      steps: steps.length ? steps : [newStep()],
    });
  };

  return (
    <div className="dashboard-content records-page">
      <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '프로토콜' }]} title="프로토콜" description="단계별 체크리스트와 결과 필드를 정의하고 버전을 발행합니다." actions={<div className="button-row">
          {aiStatus.enabled && aiStatus.features.includes('generateProtocol') && <Suspense fallback={<span role="status">AI 프로토콜 도구를 불러오는 중…</span>}><AiProtocolGenerator onOpenDraft={openAiDraft} /></Suspense>}
          <button className="btn-primary" onClick={() => setForm(newProtocol())}><Plus aria-hidden="true" /> 새 프로토콜</button>
        </div>} />
      {error && <p role="alert" className="error-banner">{error}</p>}
      <Card title={`프로토콜 · ${items.length}`}>
      {items.length > 0 && <div className="records-table-scroll"><table className="ui-table records-protocol-table"><thead><tr><th scope="col">프로토콜</th><th scope="col">상태</th><th scope="col">버전</th><th scope="col">작업</th></tr></thead><tbody>
        {items.map((item) => (
          <tr className="protocol-card" key={item.id || item._id}>
            <td><div className="ui-cell-title records-title"><span className="records-icon-tile"><ListChecks aria-hidden="true" /></span><span><h2>{item.title}</h2><small>{item.description}</small><small>{item.projectId ? projects.find((p) => p._id === item.projectId)?.name || '프로젝트' : '개인 프로토콜'} · {item.steps?.length || 0}단계</small></span></div></td>
            <td><StatusPill tone={item.status === 'published' ? 'success' : 'neutral'}>{item.status}</StatusPill></td>
            <td className="records-mono">v{item.version}</td><td>
            <div className="button-row">
              <button className="btn-ghost" onClick={() => setForm({ ...item, id: item.id || item._id })}>편집</button>
              {item.status === 'draft' && <button className="btn-primary" disabled={busy} onClick={() => publish(item)}>발행</button>}
              <button className="btn-ghost" onClick={() => showVersions(item)}>버전</button>
              <button className="btn-ghost" aria-label="보관" disabled={busy} onClick={() => remove(item)}><Archive aria-hidden="true" /></button>
            </div>
          </td></tr>
        ))}
        </tbody></table></div>}
        {!items.length && <EmptyState icon={<ListChecks />} title="등록된 프로토콜이 없습니다." />}
      </Card>
      {form && (
        <Modal title={form.id ? '프로토콜 편집' : '새 프로토콜'} wide busy={busy} onClose={() => setForm(null)}>
          <form onSubmit={save}>
            <div className="modal-body protocol-form">
              <label>제목<input className="form-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label>설명<textarea className="form-input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label>프로젝트<select className="form-input" value={form.projectId || ''} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">개인 프로토콜</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}</select></label>
              {form.steps.map((step, index) => (
                <section className="protocol-step card" key={step.id}>
                  <div className="card-header"><h3>단계 {index + 1}</h3><button type="button" className="btn-outline" onClick={() => setForm({ ...form, steps: form.steps.filter((_, i) => i !== index) })}>단계 삭제</button></div>
                  <label>단계 제목<input className="form-input" required value={step.title} onChange={(e) => changeStep(index, { title: e.target.value })} /></label>
                  <label>절차<textarea className="form-input" value={step.instructions} onChange={(e) => changeStep(index, { instructions: e.target.value })} /></label>
                  <label>체크 항목 (한 줄에 하나씩)<textarea className="form-input" value={step.checklist.map((entry) => entry.text).join('\n')} onChange={(e) => setChecklist(index, e.target.value)} /></label>
                  <label>결과 필드 (이름 | 단위 | text 또는 number)<textarea className="form-input" value={step.resultFields.map((field) => `${field.name}|${field.unit || ''}|${field.kind}`).join('\n')} onChange={(e) => setResultFields(index, e.target.value)} /></label>
                </section>
              ))}
              <button type="button" className="btn-outline" onClick={() => setForm({ ...form, steps: [...form.steps, newStep()] })}><Plus aria-hidden="true" /> 단계 추가</button>
            </div>
            <div className="modal-footer"><button className="btn-primary" disabled={busy}>{busy ? '저장 중…' : '저장'}</button></div>
          </form>
        </Modal>
      )}
      {versions && <Modal title="프로토콜 버전" wide onClose={() => setVersions(null)}><div className="modal-body">{versions.map((version) => <article className="version-item" key={version.version}><strong>v{version.version}</strong><span>{version.publishedAt ? new Date(version.publishedAt).toLocaleString() : '발행 시각 없음'}</span><small>발행자 {version.publishedBy || '정보 없음'}</small></article>)}</div></Modal>}
    </div>
  );
}
