import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { htmlToDoc } from '@labhub/note-format/html';
import { docToSafeHtml } from '@labhub/note-format';
import '@labhub/note-editor/style.css';
import useAuthStore from '../store/useAuthStore';
import useProjectStore from '../store/useProjectStore';
import { api, downloadBlob, errorMessage } from '../lib/api';
import Modal from '../components/Modal';
import SignModal from '../components/SignModal';
import CommentPanel from '../components/CommentPanel';
import Pagination from '../components/Pagination';
import ProtocolRunPanel from '../components/ProtocolRunPanel';
import VersionHistory from '../components/VersionHistory';
import {
  emptyNoteDoc,
  noteDoc,
  draftDoc,
  docToPlainText,
  normalizeDoc,
  stripUnsetDocAttributes,
} from '../lib/noteFormat';
import AiStatusContext from '../contexts/AiStatusContext';
import { formatQuantity, formatTimestampStatus } from '../lib/display';
const NoteEditor = lazy(() => import('@labhub/note-editor').then(({ NoteEditor: Editor }) => ({ default: Editor })));
const AiEditorTools = lazy(() => import('../components/ai/AiEditorTools.jsx'));
const AiNoteChecker = lazy(() => import('../components/ai/AiNoteChecker.jsx'));
const blank = () => ({
  requestId: crypto.randomUUID(),
  title: '',
  contentFormat: 'doc',
  contentDoc: emptyNoteDoc(),
  projectId: '',
  experimentId: '',
  protocolId: '',
  protocolVersion: null,
  tags: [],
  reagentsUsed: [],
  entitiesUsed: [],
  changeReason: '',
});
const builtins = [
  {
    _id: 'basic',
    name: '기본 실험 기록',
    content:
      '<h2>실험 목적</h2><p><br></p><h2>재료 및 방법</h2><p><br></p><h2>관찰 및 결과</h2><p><br></p><h2>결론과 다음 단계</h2><p><br></p>',
  },
  {
    _id: 'meeting',
    name: '연구 회의 기록',
    content:
      '<h2>논의 주제</h2><p><br></p><h2>주요 발견</h2><p><br></p><h2>결정 사항</h2><p><br></p><h2>후속 실험</h2><p><br></p>',
  },
];
export default function ELN() {
  const { user } = useAuthStore();
  const aiStatus = useContext(AiStatusContext);
  const { projects, fetchProjects } = useProjectStore();
  const [params, setParams] = useSearchParams();
  const [notes, setNotes] = useState([]),
    [total, setTotal] = useState(0),
    [lims, setLims] = useState([]),
    [entityRecords, setEntityRecords] = useState([]),
    [templates, setTemplates] = useState(builtins),
    [protocols, setProtocols] = useState([]),
    [members, setMembers] = useState([]),
    [experiments, setExperiments] = useState([]),
    [formExperiments, setFormExperiments] = useState([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState(null),
    [selected, setSelected] = useState(null),
    [historyOpen, setHistoryOpen] = useState(false);
  const [signConfig, setSignConfig] = useState(null);
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendReason, setAmendReason] = useState('');
  const [relatedNote, setRelatedNote] = useState(null);
  const [seal, setSeal] = useState(null);
  const [sealError, setSealError] = useState('');
  const [sealLoading, setSealLoading] = useState(false);
  const [sealVerification, setSealVerification] = useState(null);
  const [status, setStatus] = useState('all'),
    [project, setProject] = useState('all'),
    [experiment, setExperiment] = useState('all'),
    [trash, setTrash] = useState(false),
    [page, setPage] = useState(1);
  const [experimentEditor, setExperimentEditor] = useState(null);
  const [experimentManager, setExperimentManager] = useState(false);
  const [runDraft, setRunDraft] = useState(null);
  const [reagent, setReagent] = useState(''),
    [amount, setAmount] = useState(''),
    [selectedLotId, setSelectedLotId] = useState(''),
    [reagentLots, setReagentLots] = useState([]),
    [entityChoice, setEntityChoice] = useState('');
  const imageUrls = useRef(new Map());
  const noteContentRef = useRef(null);
  const highlightedBlock = useRef(null);
  const formRef = useRef(form);
  const requestedNote = useRef('');
  formRef.current = form;
  const revokeImageUrls = useCallback(() => {
    for (const url of imageUrls.current.values()) URL.revokeObjectURL(url);
    imageUrls.current.clear();
  }, []);
  const draftKey = `labhub-draft:${user.id}`;
  const [draft, setDraft] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey));
    } catch {
      return null;
    }
  });
  const canWrite = (n) =>
    user.role !== 'viewer' &&
    (!n?.projectId ||
      user.role === 'admin' ||
      projects
        .find((p) => p._id === n.projectId)
        ?.members.some((m) => m.userId === user.id && ['editor', 'manager'].includes(m.role)));
  const canReview = (n) =>
    user.role === 'admin' ||
    Boolean(
      n?.projectId &&
        n.authorId !== user.id &&
        projects
          .find((p) => p._id === n.projectId)
          ?.members?.some((m) => m.userId === user.id && m.role === 'manager'),
    );
  const canManageComments = (n) => user.role === 'admin' || Boolean(
    n?.projectId && projects.find((item) => item._id === n.projectId)?.members
      ?.some((member) => member.userId === user.id && member.role === 'manager'),
  );
  const listParams = useMemo(() => {
    const query = { page, limit: 15 };
    if (status !== 'all') query.status = status;
    if (project !== 'all') query.projectId = project;
    if (experiment !== 'all') query.experimentId = experiment;
    if (trash) query.trash = true;
    return query;
  }, [page, status, project, experiment, trash]);
  const loadNotes = useCallback(async () => {
    setLoading(true);
    const { data } = await api.get('/eln', { params: listParams });
    const items = Array.isArray(data) ? data : data.items || [];
    setNotes(items);
    setTotal(Array.isArray(data) ? items.length : data.total || 0);
    setLoading(false);
  }, [listParams]);
  useEffect(() => {
    let active = true;
    Promise.all([api.get('/lims'), api.get('/templates'), api.get('/protocols'), api.get('/members'), api.get('/entities', { params: { page: 1, limit: 100 } }).catch(() => ({ data: [] }))])
      .then(([l, t, p, m, entities]) => {
        if (!active) return;
        setLims(l.data);
        setTemplates([...builtins, ...(Array.isArray(t.data) ? t.data : t.data.items || [])]);
        setProtocols(Array.isArray(p.data) ? p.data : p.data.items || []);
        setMembers(m.data.filter((member) => member.isActive !== false));
        setEntityRecords(Array.isArray(entities.data) ? entities.data : entities.data.items || []);
      })
      .catch((e) => active && setError(errorMessage(e)));
    fetchProjects();
    return () => { active = false; };
  }, [fetchProjects]);
  useEffect(() => {
    let active = true;
    if (!reagent) {
      setReagentLots([]);
      setSelectedLotId('');
      return () => { active = false; };
    }
    api.get(`/lims/${encodeURIComponent(reagent)}/lots`).then(({ data }) => {
      if (active) setReagentLots(Array.isArray(data) ? data : data.items || []);
    }).catch((e) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [reagent]);
  useEffect(() => {
    let active = true;
    loadNotes().catch((e) => {
      if (active) {
        setError(errorMessage(e));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [loadNotes]);
  useEffect(() => {
    let active = true;
    if (project === 'all') {
      setExperiments([]);
      setExperiment('all');
      return () => { active = false; };
    }
    api.get(`/projects/${project}/experiments`).then(({ data }) => {
      if (active) setExperiments(Array.isArray(data) ? data : data.items || []);
    }).catch((e) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [project]);
  useEffect(() => {
    let active = true;
    if (!form?.projectId) {
      setFormExperiments([]);
      return () => { active = false; };
    }
    api.get(`/projects/${form.projectId}/experiments`).then(({ data }) => {
      if (active) setFormExperiments(Array.isArray(data) ? data : data.items || []);
    }).catch((e) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [form?.projectId]);
  useEffect(() => {
    if (!draft || (draft.contentFormat === 'doc' && draft.contentDoc?.type === 'doc')) return;
    let active = true;
    api.post('/eln/convert-html', { html: typeof draft.content === 'string' ? draft.content : '' })
      .then(({ data }) => {
        if (!active) return;
        const converted = { ...draft, contentFormat: 'doc', contentDoc: data.doc, conversionWarnings: data.warnings || [] };
        setDraft(converted);
        localStorage.setItem(draftKey, JSON.stringify(converted));
      })
      .catch((e) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [draft, draftKey]);
  useEffect(() => () => revokeImageUrls(), [revokeImageUrls]);
  useEffect(() => {
    const noteId = form?.id || selected?.id;
    if (!noteId) return undefined;
    let active = true;
    const updatePresence = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      try {
        if (form?.id === noteId) await api.post(`/eln/${noteId}/presence`, {});
        const { data } = await api.get(`/eln/${noteId}`);
        if (active) setSelected((current) => current?.id === noteId ? { ...current, editors: data.editors || [] } : current);
      } catch {
        // Presence is advisory and must not block editing.
      }
    };
    updatePresence();
    const timer = window.setInterval(updatePresence, 30_000);
    const onVisibility = () => document.visibilityState === 'visible' && updatePresence();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [form?.id, selected?.id]);
  useEffect(() => {
    const warn = (e) => {
      if (form) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form]);
  const reload = async () => {
    const [, l] = await Promise.all([loadNotes(), api.get('/lims').then(({ data }) => setLims(data))]);
    return l;
  };
  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const patch = (changes) => {
    const next = { ...(formRef.current || form), ...changes, contentFormat: 'doc' };
    formRef.current = next;
    setForm(next);
    try {
      const saved = { ...next, savedAt: new Date().toISOString() };
      localStorage.setItem(draftKey, JSON.stringify(saved));
      setDraft(saved);
      setNotice('이 기기에 초안 저장됨 · 서버 저장 전');
    } catch {
      setNotice('기기 저장 공간이 부족합니다. 서버에 저장해주세요.');
    }
  };
  const clearDraft = () => {
    localStorage.removeItem(draftKey);
    setDraft(null);
  };
  const start = (note) => {
    if (
      draft &&
      !window.confirm(
        '보관된 초안이 있습니다. 새 편집을 시작하면 새 입력으로 초안이 바뀝니다. 계속할까요?',
      )
    )
      return;
    closeSelected();
    setNotice('');
    const next = note
      ? { ...note, contentFormat: 'doc', contentDoc: noteDoc(note), changeReason: '', aiRunIds: [] }
      : { ...blank(), projectId: project === 'all' ? '' : project, experimentId: experiment === 'all' ? '' : experiment };
    formRef.current = next;
    setForm(next);
  };
  const insertAiDocument = (addedDoc, runId) => {
    const current = formRef.current || form;
    const currentDoc = noteDoc({ contentDoc: current.contentDoc || emptyNoteDoc() });
    const isEmpty = !docToPlainText(currentDoc).trim();
    const mergedDoc = normalizeDoc({
      ...currentDoc,
      content: [...(isEmpty ? [] : currentDoc.content || []), ...(addedDoc.content || [])],
    });
    patch({
      contentDoc: mergedDoc,
      aiRunIds: [...new Set([...(current.aiRunIds || []), runId])],
    });
    setNotice('AI 제안을 문서에 삽입했습니다. 검토한 뒤 저장해주세요.');
  };
  const jumpToNoteBlock = (blockIndex) => {
    const block = noteContentRef.current?.querySelector('.ProseMirror')?.children[blockIndex];
    if (!block) return;
    highlightedBlock.current?.classList.remove('ai-jump-highlight');
    block.classList.add('ai-jump-highlight');
    highlightedBlock.current = block;
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      block.classList.remove('ai-jump-highlight');
      if (highlightedBlock.current === block) highlightedBlock.current = null;
    }, 3000);
  };
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const currentForm = formRef.current || form;
      const payload = {
        ...currentForm,
        contentFormat: 'doc',
        contentDoc: stripUnsetDocAttributes(currentForm.contentDoc || emptyNoteDoc()),
        experimentId: currentForm.experimentId || null,
        protocolId: currentForm.protocolId || null,
        protocolVersion: currentForm.protocolId ? Number(currentForm.protocolVersion) : null,
        tags: (currentForm.tags || []).map((t) => t.trim()).filter(Boolean),
        reagentsUsed: (currentForm.reagentsUsed || []).map((item) => ({
          reagentId: item.reagentId,
          amount: Number(item.amount),
          unit: item.unit,
          ...(item.lotId ? { lotId: item.lotId } : {}),
        })),
        entitiesUsed: (currentForm.entitiesUsed || []).map((item) => ({ entityId: item.entityId || item.id })).filter((item) => item.entityId),
        aiRunIds: [...new Set(currentForm.aiRunIds || [])],
      };
      delete payload.content;
      if (currentForm.id) await api.put(`/eln/${currentForm.id}`, payload);
      else await api.post('/eln', payload);
      clearDraft();
      formRef.current = null;
      setForm(null);
      setNotice('서버에 저장되었습니다.');
      setPage(1);
      await reload();
    });
  };
  const open = useCallback(async (note) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.get(`/eln/${note.id}`);
      revokeImageUrls();
      setSelected(data);
      setRunDraft(data.protocolRun || null);
      setRelatedNote(null);
      setSeal(null);
      setSealVerification(null);
      setSealError('');
      setSignConfig(null);
      setSealLoading(true);
      const relationId = data.amendsNoteId || data.supersededBy;
      const [sealResult, relationResult] = await Promise.allSettled([
        api.get(`/eln/${data.id}/seal`),
        relationId ? api.get(`/eln/${relationId}`) : Promise.resolve(null),
      ]);
      if (sealResult.status === 'fulfilled')
        setSeal(sealResult.value.data.seal || sealResult.value.data);
      else if (sealResult.reason.response?.status !== 404)
        setSealError(errorMessage(sealResult.reason));
      if (relationResult.status === 'fulfilled' && relationResult.value)
        setRelatedNote(relationResult.value.data);
      setSealLoading(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [revokeImageUrls]);
  const closeSelected = () => {
    revokeImageUrls();
    setSelected(null);
    setSignConfig(null);
    if (params.has('noteId')) {
      const next = new URLSearchParams(params);
      next.delete('noteId');
      setParams(next, { replace: true });
    }
  };
  const noteParam = params.get('noteId');
  useEffect(() => {
    if (!noteParam) {
      requestedNote.current = '';
      return;
    }
    if (selected?.id === noteParam || requestedNote.current === noteParam) return;
    requestedNote.current = noteParam;
    open({ id: noteParam });
  }, [noteParam, selected?.id, open]);
  const action = (note, path, body = {}, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    run(async () => {
      await api.post(`/eln/${note.id}/${path}`, { version: note.version, ...body });
      closeSelected();
      setSignConfig(null);
      setNotice('처리되었습니다.');
      await reload();
    });
  };
  const submitSignature = async (body) => {
    if (!signConfig || !selected) return;
    setBusy(true);
    setError('');
    try {
      const config = signConfig;
      const { comment, ...credentials } = body;
      const payload = { version: selected.version, ...credentials };
      const trimmedComment = comment.trim();
      if (trimmedComment || config.requireComment) payload.comment = trimmedComment;
      await api.post(`/eln/${selected.id}/${config.path}`, {
        ...payload,
      });
      setSignConfig(null);
      closeSelected();
      setNotice(config.successMessage || '서명을 처리했습니다.');
      try {
        await reload();
      } catch (e) {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };
  const loadSeal = async () => {
    if (!selected) return;
    setSealLoading(true);
    setSealError('');
    setSealVerification(null);
    try {
      const { data } = await api.get(`/eln/${selected.id}/seal`);
      setSeal(data.seal || data);
    } catch (e) {
      setSealError(e.response?.status === 404 ? '이 노트에는 봉인이 없습니다.' : errorMessage(e));
      setSeal(null);
    } finally {
      setSealLoading(false);
    }
  };
  const verifySeal = async () => {
    if (!selected) return;
    setSealLoading(true);
    setSealError('');
    try {
      const { data } = await api.get(`/eln/${selected.id}/seal/verify`);
      setSealVerification(data);
    } catch (e) {
      setSealError(errorMessage(e));
    } finally {
      setSealLoading(false);
    }
  };
  const downloadSealFile = async (kind) => {
    if (!selected) return;
    await run(async () => {
      const { data } = await api.get(`/eln/${selected.id}/seal/${kind}`, {
        responseType: 'blob',
      });
      downloadBlob(data, `note-${selected.id}-${kind === 'pdf' ? 'sealed.pdf' : 'evidence.zip'}`);
    });
  };
  const retryTimestamp = async () => {
    if (!selected) return;
    await run(async () => {
      await api.post(`/eln/${selected.id}/seal/timestamp/retry`, {});
      await loadSeal();
    });
  };
  const createAmendment = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/eln/${selected.id}/amend`, { reason: amendReason.trim() });
      setAmendOpen(false);
      setAmendReason('');
      setSelected(data);
      setRelatedNote(selected);
      setNotice('정정용 개정판을 만들었습니다. 원본과 봉인은 보존됩니다.');
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = (note) => {
    if (window.confirm('휴지통으로 이동할까요? 시약 사용 이력과 재고는 유지됩니다.'))
      run(async () => {
        await api.delete(`/eln/${note.id}`, { data: { version: note.version } });
        closeSelected();
        await reload();
      });
  };
  const addReagent = () => {
    const item = lims.find((i) => i.id === reagent);
    const qty = Number(amount);
    if (!item || !Number.isFinite(qty) || qty <= 0) {
      setError('시약과 양수 사용량을 입력해주세요.');
      return;
    }
    if (form.reagentsUsed.some((r) => r.reagentId === reagent)) {
      setError('이미 추가된 시약입니다. 기존 항목을 제거한 후 다시 추가해주세요.');
      return;
    }
    patch({
      reagentsUsed: [
        ...form.reagentsUsed,
        { reagentId: item.id || item._id, name: item.name, amount: qty, unit: item.unit, ...(selectedLotId ? { lotId: selectedLotId } : {}) },
      ],
    });
    setReagent('');
    setAmount('');
    setSelectedLotId('');
  };
  const addEntityUsed = () => {
    const entity = entityRecords.find((item) => String(item.id || item._id) === entityChoice);
    if (!entity || (form.entitiesUsed || []).some((item) => String(item.entityId || item.id) === entityChoice)) return;
    patch({ entitiesUsed: [...(form.entitiesUsed || []), { entityId: entity.id || entity._id, code: entity.code, name: entity.name, typeName: entity.typeName }] });
    setEntityChoice('');
  };
  const usableReagentLots = reagentLots.filter((lot) => {
    const remaining = Number(lot.remainingAmount || 0);
    const expiration = lot.expirationDate ? new Date(lot.expirationDate) : null;
    return remaining > 0 && !['폐기', '소진', '만료', 'disposed', 'exhausted', 'expired'].includes(lot.status) && (!expiration || expiration >= new Date(new Date().toDateString()));
  });
  const uploadImage = useCallback(async (file) => {
    const current = formRef.current;
    if (!current?.id) throw new Error('이미지를 올리려면 먼저 노트를 저장하고 편집을 다시 열어주세요.');
    const body = new FormData();
    body.append('noteId', current.id);
    body.append('version', current.version);
    body.append('file', file);
    const { data } = await api.post('/files/upload', body);
    const next = {
      ...current,
      version: data.version,
      attachments: [...(current.attachments || []), data.file],
    };
    formRef.current = next;
    setForm(next);
    return { attachmentId: String(data.file._id), alt: file.name };
  }, []);
  const resolveImageUrl = useCallback(async (attachmentId) => {
    const id = String(attachmentId);
    if (imageUrls.current.has(id)) return imageUrls.current.get(id);
    const { data } = await api.get(`/files/${encodeURIComponent(id)}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    imageUrls.current.set(id, url);
    return url;
  }, []);
  const searchMentions = useCallback(async (query) => members
    .filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)
    .map((member) => ({ id: member.id, label: member.name })), [members]);
  const searchNotes = useCallback(async (query) => {
    if (!query.trim()) return [];
    const { data } = await api.get('/search', { params: { q: query, type: 'note', limit: 8 } });
    return (data.items || []).map((item) => ({ id: item.id, label: item.title }));
  }, []);
  const searchReagents = useCallback(async (query) => lims
    .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)
    .map((item) => ({ id: item.id, label: item.name })), [lims]);
  const saveProtocolRun = () => run(async () => {
    if (!selected || !runDraft) return;
    const { data } = await api.put(`/eln/${selected.id}`, {
      version: selected.version,
      changeReason: '프로토콜 실행 결과 기록',
      title: selected.title,
      contentFormat: 'doc',
      contentDoc: stripUnsetDocAttributes(noteDoc(selected)),
      projectId: selected.projectId || null,
      experimentId: selected.experimentId || null,
      tags: selected.tags || [],
      reagentsUsed: (selected.reagentsUsed || []).map((item) => ({ reagentId: item.reagentId, amount: Number(item.amount), unit: item.unit, ...(item.lotId ? { lotId: item.lotId } : {}) })),
      entitiesUsed: (selected.entitiesUsed || []).map((item) => ({ entityId: item.entityId || item.id })).filter((item) => item.entityId),
      protocolRun: {
        protocolId: runDraft.protocolId,
        version: runDraft.version,
        stepResults: runDraft.stepResults || [],
      },
    });
    setSelected(data);
    setRunDraft(data.protocolRun || runDraft);
    await reload();
  });
  const loadProjectExperiments = async () => {
    if (project === 'all') return;
    const { data } = await api.get(`/projects/${project}/experiments`);
    setExperiments(Array.isArray(data) ? data : data.items || []);
  };
  const saveExperiment = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { name: experimentEditor.name.trim(), description: experimentEditor.description.trim(), status: experimentEditor.status };
      if (experimentEditor.id) await api.put(`/experiments/${experimentEditor.id}`, payload);
      else await api.post(`/projects/${project}/experiments`, payload);
      setExperimentEditor(null);
      await loadProjectExperiments();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const deleteExperiment = async (item) => {
    if (!window.confirm(`“${item.name}” 실험을 보관할까요?`)) return;
    setBusy(true);
    try {
      await api.delete(`/experiments/${item.id || item._id}`);
      if (experiment === (item.id || item._id)) setExperiment('all');
      await loadProjectExperiments();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const canManageExperiments = user.role === 'admin' || projects
    .find((item) => item._id === project)?.members
    .some((member) => member.userId === user.id && member.role === 'manager');
  const openNoteReference = (event) => {
    const link = event.target.closest?.('a[data-note-id]');
    if (!link) return;
    event.preventDefault();
    const id = link.getAttribute('data-note-id');
    if (id) open({ id });
  };
  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">RESEARCH WORKSPACE</p>
          <h1 className="page-title">연구노트</h1>
          <p className="muted">실험의 과정부터 결과까지, 한곳에서 기록하세요.</p>
        </div>
        <div className="button-row">
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setTrash(!trash);
              setLoading(true);
              setPage(1);
            }}
          >
            {trash ? '노트로 돌아가기' : '휴지통'}
          </button>
          {user.role !== 'viewer' && !trash && (
            <button className="btn-primary" onClick={() => start()}>
              ＋ 새 노트 작성
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button aria-label="오류 닫기" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {notice && !form && (
        <p role="status" className="notice-banner">
          {notice}
        </p>
      )}
      {draft && !form && (
        <div className="draft-banner">
          <span>
            저장하지 않은 초안: <strong>{draft.title || '제목 없음'}</strong>
          </span>
          <div className="button-row">
            <button
              className="btn-outline"
              onClick={() => {
                const recovered = { ...draft, contentFormat: 'doc', contentDoc: draftDoc(draft) };
                formRef.current = recovered;
                setForm(recovered);
                setNotice('기기 초안 복구됨 · 서버 저장 전');
              }}
            >
              초안 복구
            </button>
            <button
              className="btn-outline"
              onClick={() => {
                if (window.confirm('기기 초안을 삭제할까요?')) clearDraft();
              }}
            >
              초안 삭제
            </button>
          </div>
        </div>
      )}
      <div className="filter-row">
        <select
          aria-label="프로젝트 필터"
          className="form-input"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setExperiment('all');
            setPage(1);
          }}
        >
          <option value="all">모든 프로젝트</option>
          {projects.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="실험 필터"
          className="form-input"
          disabled={project === 'all'}
          value={experiment}
          onChange={(e) => { setExperiment(e.target.value); setPage(1); }}
        >
          <option value="all">모든 실험</option>
          {experiments.map((item) => <option key={item.id || item._id} value={item.id || item._id}>{item.name}</option>)}
        </select>
        <select
          aria-label="상태 필터"
          className="form-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">모든 상태</option>
          {['진행중', '승인대기', '승인됨', '반려'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {project !== 'all' && !trash && canManageExperiments && <button className="btn-outline" onClick={() => setExperimentManager(true)}>실험 관리</button>}
      </div>
      <p className="hierarchy-path" aria-label="현재 위치">
        프로젝트{project !== 'all' ? `: ${projects.find((item) => item._id === project)?.name || ''}` : ''}
        {experiment !== 'all' ? `  ›  실험: ${experiments.find((item) => (item.id || item._id) === experiment)?.name || ''}` : ''}
        {'  ›  연구노트'}
      </p>
      <section className="card">
        <div className="card-header">
          <h2>
            {trash ? '휴지통' : '연구 기록'} <span className="muted">{total}</span>
          </h2>
          <button disabled={busy} className="btn-outline" onClick={() => run(reload)}>
            새로고침
          </button>
        </div>
        {loading ? (
          <p className="empty-state" role="status">
            연구 기록을 불러오는 중…
          </p>
        ) : !notes.length ? (
          <div className="empty-state">
            <h3>
              {status !== 'all' || project !== 'all' || experiment !== 'all'
                ? '검색 결과가 없습니다.'
                : trash
                  ? '휴지통이 비어 있습니다.'
                  : '첫 실험을 기록해보세요.'}
            </h3>
            <p>템플릿으로 시작하고 자료를 첨부할 수 있습니다.</p>
          </div>
        ) : (
          <div className="note-list">
            {notes.map((n) => (
              <article key={n.id} className="note-row">
                <button className="note-open" onClick={() => !trash && open(n)} disabled={trash}>
                  <span className="note-glyph">▤</span>
                  <span>
                    <strong>{n.title}</strong>
                    <small>
                      {n.author} · {n.date} · v{n.version} ·{' '}
                      {projects.find((p) => p._id === n.projectId)?.name || '개인 노트'}
                      {n.experimentName ? ` · ${n.experimentName}` : ''}
                    </small>
                    <span className="tag-list">
                      {n.tags?.map((t) => (
                        <span className="tag" key={t}>
                          #{t}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
                <span
                  className={`status-pill status-${n.status === '승인됨' ? 'approved' : n.status === '반려' ? 'rejected' : 'draft'}`}
                >
                  {n.status}
                </span>
                {trash && canWrite(n) && (
                  <button
                    className="btn-outline"
                    disabled={busy}
                    onClick={() => action(n, 'restore')}
                  >
                    복원
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        {total > 15 && <Pagination page={page} limit={15} total={total} onPage={setPage} />}
      </section>
      {form && (
        <Modal
          title={form.id ? '연구노트 편집' : '새 연구노트'}
          wide
          busy={busy}
          onClose={() => { formRef.current = null; setForm(null); }}
        >
          <form onSubmit={save}>
            <div className="modal-body editor-body">
              {error && (
                <p role="alert" className="error-banner">
                  {error}
                </p>
              )}
              <p role="status" className="muted">
                {notice || '변경 내용은 이 기기에 초안으로 보관됩니다.'}
              </p>
              <label className="form-group">
                제목
                <input
                  autoFocus
                  required
                  maxLength={200}
                  className="form-input"
                  value={form.title}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
              <div className="filter-row">
                <label>
                  프로젝트
                  <select
                    className="form-input"
                    value={form.projectId || ''}
                    onChange={(e) => patch({ projectId: e.target.value, experimentId: '' })}
                  >
                    <option value="">개인 노트 (작성자·관리자)</option>
                    {projects
                      .filter((p) => canWrite({ projectId: p._id }))
                      .map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  실험
                  <select
                    className="form-input"
                    disabled={!form.projectId}
                    value={form.experimentId || ''}
                    onChange={(e) => patch({ experimentId: e.target.value })}
                  >
                    <option value="">실험 미지정</option>
                    {formExperiments.map((item) => <option key={item.id || item._id} value={item.id || item._id}>{item.name}</option>)}
                  </select>
                </label>
                <label>
                  템플릿
                  <select
                    className="form-input"
                    defaultValue=""
                    onChange={(e) => {
                      const t = templates.find((t) => t._id === e.target.value);
                      if (
                        t &&
                        (!docToPlainText(form.contentDoc).trim() || window.confirm('본문을 선택한 템플릿으로 바꿀까요?'))
                      )
                        patch({ contentDoc: t.contentDoc || htmlToDoc(t.content || '').doc });
                      e.target.value = '';
                    }}
                  >
                    <option value="">템플릿 선택</option>
                    {templates.map((t) => (
                      <option value={t._id} key={t._id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="form-group">
                태그 (쉼표로 구분)
                <input
                  className="form-input"
                  value={(form.tags || []).join(',')}
                  onChange={(e) => patch({ tags: e.target.value.split(',') })}
                />
              </label>
              {!form.id && (
                <label className="form-group">
                  프로토콜로 실행 시작
                  <select
                    className="form-input"
                    value={form.protocolId ? `${form.protocolId}:${form.protocolVersion}` : ''}
                    onChange={(e) => {
                      const [protocolId, protocolVersion] = e.target.value.split(':');
                      patch({ protocolId: protocolId || '', protocolVersion: protocolVersion ? Number(protocolVersion) : null });
                    }}
                  >
                    <option value="">프로토콜 없이 작성</option>
                    {protocols.filter((item) => item.status === 'published' && (!item.projectId || item.projectId === form.projectId)).map((item) => (
                      <option key={item.id || item._id} value={`${item.id || item._id}:${item.version}`}>{item.title} · v{item.version}</option>
                    ))}
                  </select>
                </label>
              )}
              {form.conversionWarnings?.length > 0 && <div className="warning-banner"><strong>레거시 문서 변환 안내</strong>{form.conversionWarnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
              {aiStatus.enabled && aiStatus.features.some((feature) => ['draftNote', 'extractTables'].includes(feature)) && <Suspense fallback={<p role="status">AI 문서 도구를 불러오는 중…</p>}><AiEditorTools features={aiStatus.features} attachments={form.attachments || []} onInsert={insertAiDocument} /></Suspense>}
              <Suspense fallback={<p role="status">블록 편집기를 불러오는 중…</p>}>
                <NoteEditor
                  value={form.contentDoc || emptyNoteDoc()}
                  onChange={(contentDoc) => patch({ contentDoc })}
                  onUploadImage={form.id ? uploadImage : undefined}
                  resolveImageUrl={resolveImageUrl}
                  searchMentions={searchMentions}
                  searchNotes={searchNotes}
                  searchReagents={searchReagents}
                />
              </Suspense>
              {form.id ? (
                <p className="muted">이미지는 서버에 저장하고 문서에는 첨부 ID를 기록합니다.</p>
              ) : (
                <p className="muted">이미지 업로드는 노트를 먼저 저장한 뒤 편집 화면에서 사용할 수 있습니다.</p>
              )}
              {form.editors?.some((editor) => editor.id !== user.id) && <p className="presence-notice">{form.editors.filter((editor) => editor.id !== user.id).map((editor) => editor.name).join(', ')}님이 같은 노트를 편집 중입니다.</p>}
              {form.id && (
                <label className="form-group">
                  수정 사유
                  <input
                    required
                    className="form-input"
                    value={form.changeReason}
                    onChange={(e) => patch({ changeReason: e.target.value })}
                  />
                </label>
              )}
              <section className="reagent-selector entity-usage-selector">
                <h3>사용한 샘플·장비</h3>
                <p className="muted">저장 시 선택한 개체 정보가 노트에 스냅샷으로 기록됩니다.</p>
                <div className="filter-row">
                  <select aria-label="사용 개체 선택" className="form-input" value={entityChoice} onChange={(e) => setEntityChoice(e.target.value)}>
                    <option value="">개체 선택</option>
                    {entityRecords.map((item) => <option key={item.id || item._id} value={item.id || item._id}>{item.code} · {item.name}</option>)}
                  </select>
                  <button type="button" className="btn-outline" disabled={!entityChoice} onClick={addEntityUsed}>추가</button>
                </div>
                <div className="tag-list">
                  {(form.entitiesUsed || []).map((item) => {
                    const id = item.entityId || item.id;
                    return <span key={id} className="tag">{item.code ? `${item.code} · ` : ''}{item.name || id}<button type="button" aria-label={`${item.name || item.code || id} 제거`} onClick={() => patch({ entitiesUsed: (form.entitiesUsed || []).filter((entry) => String(entry.entityId || entry.id) !== String(id)) })}>×</button></span>;
                  })}
                </div>
              </section>
              <section className="reagent-selector">
                <h3>사용한 시약</h3>
                <p className="muted">LOT을 지정하거나 서버 FIFO 배정을 사용합니다. 저장 시 배정 LOT이 노트에 기록됩니다.</p>
                <div className="filter-row">
                  <select
                    aria-label="시약 선택"
                    className="form-input"
                    value={reagent}
                    onChange={(e) => setReagent(e.target.value)}
                  >
                    <option value="">시약 선택</option>
                    {lims.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} · {formatQuantity(i.stockValue)} {i.unit}
                      </option>
                    ))}
                  </select>
                  <select aria-label="시약 LOT 선택" className="form-input" disabled={!reagent} value={selectedLotId} onChange={(e) => setSelectedLotId(e.target.value)}>
                    <option value="">자동 배정 (유효기한 빠른 순)</option>
                    {usableReagentLots.map((lot) => <option key={lot.id || lot._id} value={lot.id || lot._id}>{lot.lotNumber} · 잔량 {formatQuantity(lot.remainingAmount)} {lot.unit || ''}{lot.expirationDate ? ` · ${String(lot.expirationDate).slice(0, 10)}` : ''}</option>)}
                  </select>
                  <input
                    aria-label="시약 사용량"
                    className="form-input"
                    type="number"
                    min="0.000001"
                    step="any"
                    placeholder="사용량"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <button type="button" className="btn-outline" onClick={addReagent}>
                    추가
                  </button>
                </div>
                <div className="tag-list">
                  {form.reagentsUsed.map((r) => (
                    <div key={r.reagentId} className="reagent-use-item">
                      <span className="tag">{r.name} {formatQuantity(r.amount)} {r.unit}{r.lotId ? ` · LOT ${reagentLots.find((lot) => String(lot.id || lot._id) === String(r.lotId))?.lotNumber || r.lotId}` : ' · FIFO 배정'}<button type="button" aria-label={`${r.name} 제거`} onClick={() => patch({ reagentsUsed: form.reagentsUsed.filter((x) => x.reagentId !== r.reagentId) })}>×</button></span>
                      {r.allocations?.length > 0 && <small className="allocation-list">배정: {r.allocations.map((allocation) => `${allocation.lotNumber} (${formatQuantity(allocation.amount)} ${r.unit})`).join(', ')}</small>}
                    </div>
                  ))}
                </div>
              </section>
              <p className="muted">첨부 파일과 이미지는 노트 저장 후 추가할 수 있습니다.</p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => { formRef.current = null; setForm(null); }}
              >
                초안 보관하고 닫기
              </button>
              <button className="btn-primary" disabled={busy}>
                {busy ? '저장 중…' : '서버에 저장'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={`연구노트 · v${selected.version}`}
          wide
          busy={busy}
          onClose={closeSelected}
        >
          <div className="modal-body note-detail">
            {notice && (
              <p className="notice-banner no-print" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="error-banner no-print">
                {error}
              </p>
            )}
            <h1>{selected.title}</h1>
            <p className="muted">
              {selected.author} · {selected.date} · {selected.status}
              {selected.amendmentNo ? ` · 개정 ${selected.amendmentNo}` : ''}
            </p>
            {selected.editors?.some((editor) => editor.id !== user.id) && (
              <p className="presence-notice">{selected.editors.filter((editor) => editor.id !== user.id).map((editor) => editor.name).join(', ')}님이 이 노트를 편집 중입니다.</p>
            )}
            {selected.conversionWarnings?.length > 0 && <div className="warning-banner"><strong>레거시 문서 변환 안내</strong>{selected.conversionWarnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
            {selected.amendsNoteId && (
              <section className="amendment-reference">
                <h3>정정 개정판</h3>
                <p>원본 노트 내용은 보존됩니다. 원본의 시약과 첨부는 읽기 전용 참조입니다.</p>
                {selected.amendmentReason && <p>정정 사유: {selected.amendmentReason}</p>}
                {relatedNote && (
                  <>
                    <p>원본: {relatedNote.title} · v{relatedNote.version}</p>
                    <button className="btn-outline" onClick={() => open(relatedNote)}>
                      원본 노트 열기
                    </button>
                    {!!relatedNote.reagentsUsed?.length && (
                      <div>
                        <strong>원본 시약 사용 내역 (읽기 전용)</strong>
                        {relatedNote.reagentsUsed.map((r, i) => (
                          <p key={`${r.reagentId}-${i}`}>{r.name}: {formatQuantity(r.amount)} {r.unit}</p>
                        ))}
                      </div>
                    )}
                    {!!relatedNote.attachments?.length && (
                      <div>
                        <strong>원본 첨부 (읽기 전용)</strong>
                        {relatedNote.attachments.map((file) => (
                          <p key={file._id}>{file.originalName} · {file.sha256 || '해시 미제공'}</p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
            {selected.supersededBy && (
              <section className="amendment-reference">
                <p>이 노트에는 개정판이 연결되어 있습니다. 원본과 봉인은 보존됩니다.</p>
                {relatedNote && (
                  <button className="btn-outline" onClick={() => open(relatedNote)}>
                    개정판 열기: {relatedNote.title}
                  </button>
                )}
              </section>
            )}
            <div className="note-content-rendered" ref={noteContentRef} onClick={openNoteReference}>
              <Suspense fallback={<p role="status">문서를 불러오는 중…</p>}>
                <NoteEditor value={noteDoc(selected)} readOnly resolveImageUrl={resolveImageUrl} />
              </Suspense>
            </div>
            {aiStatus.enabled && aiStatus.features.includes('checkNote') && <Suspense fallback={<p role="status">AI 점검 기능을 불러오는 중…</p>}><AiNoteChecker noteId={selected.id} onJump={jumpToNoteBlock} /></Suspense>}
            <ProtocolRunPanel
              run={runDraft}
              editable={canWrite(selected) && ['진행중', '반려'].includes(selected.status)}
              onChange={setRunDraft}
              onSave={saveProtocolRun}
              busy={busy}
            />
            {!!selected.reagentsUsed.length && (
              <section>
                <h3>시약 사용</h3>
                {selected.reagentsUsed.map((r) => (
                  <p key={r.reagentId}>
                    {r.name}: {formatQuantity(r.amount)} {r.unit}{r.allocations?.length ? ` · LOT 배정 ${r.allocations.map((allocation) => `${allocation.lotNumber} ${formatQuantity(allocation.amount)} ${r.unit}`).join(', ')}` : r.lotId ? ` · 지정 LOT ${r.lotNumber || r.lotId}` : ''}
                  </p>
                ))}
              </section>
            )}
            {!!selected.entitiesUsed?.length && <section className="entities-used-summary"><h3>사용 샘플·장비</h3><ul>{selected.entitiesUsed.map((item) => <li key={item.entityId || item.id}>{item.code} · {item.name} {item.typeName ? `(${item.typeName})` : ''}</li>)}</ul></section>}
            <section className="attachment-section">
              <h3>첨부 자료</h3>
              {selected.attachments?.length ? (
                selected.attachments.map((f) => (
                  <div className="attachment-row" key={f._id}>
                    <button
                      className="btn-outline"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const { data } = await api.get(`/files/${f._id}/download`, {
                            responseType: 'blob',
                          });
                          downloadBlob(data, f.originalName);
                        })
                      }
                    >
                      {f.originalName} ({Math.ceil(f.size / 1024)} KB) ↓
                    </button>
                    {canWrite(selected) && ['진행중', '반려'].includes(selected.status) && (
                      <button
                        className="btn-outline no-print"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('첨부파일을 삭제할까요?'))
                            run(async () => {
                              await api.delete(`/files/${f._id}`, {
                                data: { version: selected.version },
                              });
                              const { data } = await api.get(`/eln/${selected.id}`);
                              setSelected(data);
                              await reload();
                            });
                        }}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">첨부된 자료가 없습니다.</p>
              )}
              {canWrite(selected) && ['진행중', '반려'].includes(selected.status) && (
                <label className="upload-label no-print">
                  파일 추가 (최대 20 MB)
                  <input
                    type="file"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      e.target.value = '';
                      if (!file) return;
                      if (file.size > 20 * 1024 * 1024) {
                        setError('첨부파일은 20 MB 이하로 선택해주세요.');
                        return;
                      }
                      run(async () => {
                        const body = new FormData();
                        body.append('noteId', selected.id);
                        body.append('version', selected.version);
                        body.append('file', file);
                        await api.post('/files/upload', body);
                        const { data } = await api.get(`/eln/${selected.id}`);
                        setSelected(data);
                        await reload();
                      });
                    }}
                  />
                </label>
              )}
            </section>
            {!!selected.signatures?.length && (
              <section>
                <h3>검토 기록</h3>
                {selected.signatures.map((s, i) => (
                  <div className="signature-record" key={i}>
                    <strong>
                      {s.name} · {s.decision === 'reject' ? '반려' : '승인'} · v{s.version}
                    </strong>
                    <p>{s.comment}</p>
                    <small>
                      {new Date(s.signedAt).toLocaleString()} · {s.contentHash?.slice(0, 16)}
                    </small>
                  </div>
                ))}
              </section>
            )}
            <CommentPanel note={selected} doc={noteDoc(selected)} canManage={canManageComments(selected)} />
            <section className="seal-panel">
              <h3>봉인·증빙</h3>
              {sealLoading && <p role="status">봉인 정보를 불러오는 중…</p>}
              {!sealLoading && !seal && (
                <p className="muted">
                  {selected.status === '승인됨' ? '봉인 이전 기록입니다.' : '승인 완료 후 봉인이 생성됩니다.'}
                </p>
              )}
              {sealError && <p role="alert" className="error-banner">{sealError}</p>}
              {seal && (
                <>
                  <dl className="seal-summary">
                    <div>
                      <dt>봉인 해시</dt>
                      <dd><code className="hash-value">{seal.sealHash || '미제공'}</code></dd>
                    </div>
                    <div>
                      <dt>매니페스트 SHA-256</dt>
                      <dd><code className="hash-value">{seal.manifestSha256 || '미제공'}</code></dd>
                    </div>
                    <div>
                      <dt>서버 봉인 시각</dt>
                      <dd>{seal.createdAt ? new Date(seal.createdAt).toLocaleString() : '미제공'}</dd>
                    </div>
                    <div>
                      <dt>시점인증 상태</dt>
                      <dd>
                        {formatTimestampStatus(seal.timestamp, sealVerification?.timestamp?.isTrusted === false)}
                      </dd>
                    </div>
                    <div>
                      <dt>인증서 시각 (genTime)</dt>
                      <dd>{seal.timestamp?.genTime ? new Date(seal.timestamp.genTime).toLocaleString() : '시점인증 시각 없음'}</dd>
                    </div>
                    {seal.timestamp?.tsaName && (
                      <div><dt>시점인증 기관</dt><dd>{seal.timestamp.tsaName}</dd></div>
                    )}
                  </dl>
                  {!!seal.signatures?.length && (
                    <div>
                      <strong>봉인 서명자</strong>
                      {seal.signatures.map((signature, i) => (
                        <p className="signature-record" key={`${signature.keyId || signature.userId}-${i}`}>
                          {signature.name || signature.userId} · {signature.role === 'author' ? '작성자' : '점검자'}
                          {signature.signedAt && ` · ${new Date(signature.signedAt).toLocaleString()}`}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="button-row no-print">
                    <button className="btn-outline" disabled={busy} onClick={() => downloadSealFile('pdf')}>
                      봉인 PDF 다운로드
                    </button>
                    <button className="btn-outline" disabled={busy} onClick={() => downloadSealFile('bundle')}>
                      증빙 패키지 다운로드
                    </button>
                    <button className="btn-secondary" disabled={sealLoading} onClick={verifySeal}>
                      서버 검증 실행
                    </button>
                    {canReview(selected) && ['pending', 'failed'].includes(seal.timestamp?.status) && (
                      <button className="btn-outline" disabled={busy} onClick={retryTimestamp}>
                        시점인증 재요청
                      </button>
                    )}
                    {seal.verifyId && (
                      <a className="btn-outline" href={`/verify/${encodeURIComponent(seal.verifyId)}`} target="_blank" rel="noreferrer">
                        공개 검증 결과
                      </a>
                    )}
                  </div>
                  {sealVerification && (
                    <div className="verification-checks" aria-live="polite">
                      <p className={sealVerification.valid ? 'verify-result valid' : 'verify-result invalid'}>
                        {sealVerification.valid ? '서버 검증 통과' : '서버 검증 실패'}
                      </p>
                      {sealVerification.checks?.map((check) => (
                        <p key={check.id}>
                          <strong>{check.id}</strong> · {check.ok ? '통과' : '실패'} · {check.detail}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
            {selected.status === '승인대기' && canReview(selected) && selected.authorId !== user.id && (
              <section className="review-panel no-print">
                <h3>노트 점검</h3>
                <p className="muted">프로젝트 관리자 또는 시스템 관리자 자격으로 점검자 서명을 진행합니다.</p>
                <div className="button-row">
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => setSignConfig({
                      path: 'approve',
                      title: '점검자 서명 및 승인',
                      meaning: '현재 버전과 작성자 서명을 확인한 뒤 점검자 서명으로 승인합니다.',
                      submitLabel: '서명하고 승인',
                      commentLabel: '검토 의견 (선택)',
                      successMessage: '노트를 승인하고 봉인했습니다.',
                    })}
                  >
                    승인 및 잠금
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setSignConfig({
                      path: 'reject',
                      title: '점검자 서명 및 반려',
                      meaning: '반려 사유와 현재 버전을 확인한 뒤 점검자 서명으로 반려합니다.',
                      submitLabel: '서명하고 반려',
                      requireComment: true,
                      danger: true,
                      successMessage: '노트를 반려했습니다.',
                    })}
                  >
                    반려
                  </button>
                </div>
              </section>
            )}
            {selected.status === '승인대기' && selected.authorId === user.id && (
              <p className="muted">다른 관리자의 검토를 기다리고 있습니다.</p>
            )}
          </div>
          <div className="modal-footer no-print wrap">
            <button
              className="btn-outline"
              disabled={busy}
              onClick={() => setHistoryOpen(true)}
            >
              변경 이력
            </button>
            <button
              className="btn-outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { data } = await api.get(`/eln/${selected.id}/export`);
                  downloadBlob(data, `note-${selected.id}.json`);
                })
              }
            >
              JSON 내보내기
            </button>
            <button className="btn-outline" onClick={() => window.print()}>
              인쇄 / PDF
            </button>
            {canWrite(selected) && ['진행중', '반려'].includes(selected.status) && (
              <>
                <button className="btn-outline" disabled={busy} onClick={() => remove(selected)}>
                  휴지통
                </button>
                <button className="btn-secondary" disabled={busy} onClick={() => start(selected)}>
                  편집
                </button>
                <button
                  className="btn-primary"
                  disabled={busy}
                  hidden={selected.authorId !== user.id}
                  onClick={() => setSignConfig({
                    path: 'request-approval',
                    title: '작성자 서명 및 검토 요청',
                    meaning: '현재 노트 버전과 내용을 확인했다는 서명입니다. 서명 후에는 편집이 잠깁니다.',
                    submitLabel: '서명하고 요청',
                    successMessage: '작성자 서명과 검토 요청을 완료했습니다.',
                  })}
                >
                  승인 요청
                </button>
                <button
                  className="btn-outline"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.post('/templates', {
                        name: selected.title,
                        content: docToSafeHtml(noteDoc(selected)),
                        description: '연구노트에서 생성',
                      });
                      setNotice('팀 템플릿으로 저장되었습니다.');
                      const { data } = await api.get('/templates');
                      setTemplates([...builtins, ...(Array.isArray(data) ? data : data.items || [])]);
                    })
                  }
                >
                  팀 템플릿으로 저장
                </button>
              </>
            )}
            {(selected.authorId === user.id || canReview(selected)) && selected.status === '승인대기' && (
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => action(selected, 'cancel-approval')}
              >
                승인 요청 취소
              </button>
            )}
            {canWrite(selected) && selected.status === '승인됨' && !selected.supersededBy && (
              <button className="btn-secondary" disabled={busy} onClick={() => setAmendOpen(true)}>
                정정 (개정판 작성)
              </button>
            )}
          </div>
        </Modal>
      )}
      {signConfig && selected && (
        <SignModal
          title={signConfig.title}
          meaning={signConfig.meaning}
          submitLabel={signConfig.submitLabel}
          danger={signConfig.danger}
          requireComment={signConfig.requireComment}
          commentLabel={signConfig.commentLabel}
          busy={busy}
          onCancel={() => setSignConfig(null)}
          onSubmit={submitSignature}
        />
      )}
      {amendOpen && selected && (
        <Modal
          title="승인 후 정정 개정판 작성"
          busy={busy}
          onClose={() => {
            setAmendOpen(false);
            setAmendReason('');
          }}
        >
          <form onSubmit={createAmendment}>
            <div className="modal-body">
              <p>원본 노트와 봉인은 보존됩니다. 개정판에는 시약 사용 내역과 첨부가 복사되지 않습니다.</p>
              <label className="form-group">
                정정 사유
                <textarea
                  required
                  minLength={1}
                  maxLength={2000}
                  autoFocus
                  className="form-input"
                  value={amendReason}
                  onChange={(e) => setAmendReason(e.target.value)}
                />
              </label>
              {error && <p role="alert" className="error-banner">{error}</p>}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setAmendOpen(false);
                  setAmendReason('');
                }}
              >
                취소
              </button>
              <button className="btn-primary" disabled={busy || !amendReason.trim()}>
                {busy ? '생성 중…' : '개정판 작성'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {historyOpen && selected && (
        <VersionHistory
          note={selected}
          onClose={() => setHistoryOpen(false)}
          onRestored={async (data) => { setSelected(data); setRunDraft(data.protocolRun || null); await reload(); }}
        />
      )}
      {experimentManager && project !== 'all' && (
        <Modal title="프로젝트 실험 관리" wide busy={busy} onClose={() => { setExperimentManager(false); setExperimentEditor(null); }}>
          <div className="modal-body">
            <p className="muted">{projects.find((item) => item._id === project)?.name}</p>
            {experimentEditor && (
              <form className="experiment-form" onSubmit={saveExperiment}>
                <label>실험명<input required maxLength={200} className="form-input" value={experimentEditor.name} onChange={(e) => setExperimentEditor({ ...experimentEditor, name: e.target.value })} /></label>
                <label>설명<textarea className="form-input" value={experimentEditor.description || ''} onChange={(e) => setExperimentEditor({ ...experimentEditor, description: e.target.value })} /></label>
                <label>상태<select className="form-input" value={experimentEditor.status || 'active'} onChange={(e) => setExperimentEditor({ ...experimentEditor, status: e.target.value })}><option value="active">진행중</option><option value="done">완료</option><option value="archived">보관</option></select></label>
                <div className="button-row"><button className="btn-primary" disabled={busy}>저장</button><button type="button" className="btn-outline" onClick={() => setExperimentEditor(null)}>취소</button></div>
              </form>
            )}
            <button className="btn-outline" onClick={() => setExperimentEditor({ name: '', description: '', status: 'active' })}>＋ 새 실험</button>
            <div className="experiment-list">{experiments.map((item) => <article className="note-row" key={item.id || item._id}><div><strong>{item.name}</strong><small>{item.status} · {item.description}</small></div><div className="button-row"><button className="btn-outline" onClick={() => setExperimentEditor({ ...item, id: item.id || item._id })}>편집</button><button className="btn-outline" disabled={busy} onClick={() => deleteExperiment(item)}>보관</button></div></article>)}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
