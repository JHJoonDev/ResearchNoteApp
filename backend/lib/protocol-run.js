import Protocol from '../models/Protocol.js';
import ProtocolVersion from '../models/ProtocolVersion.js';
import { fail, objectId, projectAccess } from './core.js';

export async function createProtocolRun(protocolId, version, noteProjectId, user, session) {
  const hasId = protocolId !== undefined && protocolId !== null && protocolId !== '';
  const hasVersion = version !== undefined && version !== null && version !== '';
  if (!hasId && !hasVersion) return undefined;
  if (!hasId || !Number.isInteger(Number(version)) || Number(version) < 1) fail(400, '프로토콜과 버전을 확인해주세요.');
  const validatedProtocolId = objectId(protocolId);
  const protocol = await Protocol.findOne({ _id: validatedProtocolId, isDeleted: false }).session(session);
  if (!protocol) fail(404, '프로토콜이 없습니다.');
  if (protocol.projectId) {
    if (String(protocol.projectId) !== String(noteProjectId || '')) fail(400, '프로토콜은 노트와 같은 프로젝트에 있어야 합니다.');
    await projectAccess(user, protocol.projectId, false, session);
  } else if (user.role !== 'admin' && String(protocol.createdBy) !== user.id) {
    fail(403, '개인 프로토콜에 접근할 수 없습니다.');
  }
  const published = await ProtocolVersion.findOne({ protocolId: validatedProtocolId, version: Number(version) }).session(session);
  if (!published) fail(400, '요청한 프로토콜 버전이 게시되지 않았습니다.');
  const snapshot = published.snapshot;
  return {
    protocolId: String(protocol._id), version: Number(version), title: snapshot.title,
    snapshot,
    stepResults: (snapshot.steps || []).map((step) => ({ stepId: step.id, checked: [], values: {}, note: '' })),
  };
}

export function validateProtocolStepResults(snapshot, values) {
  if (!Array.isArray(values) || values.length > 200) fail(400, '단계 결과를 확인해주세요.');
  const incoming = new Map();
  for (const result of values) {
    if (!result || typeof result.stepId !== 'string' || incoming.has(result.stepId)) fail(400, '단계 결과 ID가 올바르지 않거나 중복되었습니다.');
    incoming.set(result.stepId, result);
  }
  const knownSteps = new Map((snapshot.steps || []).map((step) => [step.id, step]));
  for (const id of incoming.keys()) if (!knownSteps.has(id)) fail(400, '단계 결과가 존재하지 않는 단계를 참조합니다.');
  return (snapshot.steps || []).map((step) => {
    const result = incoming.get(step.id) || {};
    const checklistIds = new Set((step.checklist || []).map((item) => item.id));
    if (result.checked !== undefined && (!Array.isArray(result.checked) || result.checked.length > 100 || result.checked.some((id) => typeof id !== 'string' || !checklistIds.has(id)))) fail(400, '체크 항목 결과를 확인해주세요.');
    const fields = new Map((step.resultFields || []).map((field) => [field.id, field]));
    const suppliedValues = result.values ?? {};
    if (!suppliedValues || typeof suppliedValues !== 'object' || Array.isArray(suppliedValues) || Object.keys(suppliedValues).length > 100) fail(400, '단계 결과 값 형식이 올바르지 않습니다.');
    for (const [id, value] of Object.entries(suppliedValues)) {
      const field = fields.get(id);
      if (!field) fail(400, '단계 결과가 존재하지 않는 결과 항목을 참조합니다.');
      if (field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail(400, '숫자 결과를 확인해주세요.');
      if (field.kind === 'text' && (typeof value !== 'string' || value.length > 10000)) fail(400, '문자 결과는 10,000자 이하여야 합니다.');
    }
    if (result.note !== undefined && (typeof result.note !== 'string' || result.note.length > 2000)) fail(400, '단계 메모는 2,000자 이하여야 합니다.');
    return { stepId: step.id, checked: [...new Set(result.checked || [])], values: { ...suppliedValues }, note: result.note || '' };
  });
}
