import express from 'express';
import crypto from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import mongoose from 'mongoose';
import { ZipArchive } from 'archiver';
import User from '../models/User.js';
import Project from '../models/Project.js';
import NoteSeal from '../models/NoteSeal.js';
import ElnNote from '../models/ElnNote.js';
import AiRun from '../models/AiRun.js';
import ElnVersion from '../models/ElnVersion.js';
import FileAttachment from '../models/FileAttachment.js';
import Experiment from '../models/Experiment.js';
import Entity from '../models/Entity.js';
import EntityType from '../models/EntityType.js';
import LimsItem from '../models/LimsItem.js';
import NotePresence from '../models/NotePresence.js';
import { parseWriteContent, readContent, hasDocumentContent, references, validateAndNormalizeDoc } from '../lib/note-doc.js';
import { createProtocolRun, validateProtocolStepResults } from '../lib/protocol-run.js';
import { indexNoteAfterCommit } from '../lib/search.js';
import { auth, writer } from '../middleware/auth.js';
import {
  text,
  fail,
  cleanContent,
  serialize,
  objectId,
  noteFilter,
  getNote,
  projectAccess,
  checkVersion,
  audit,
} from '../lib/core.js';
import { adjustReagents } from '../lib/inventory.js';
import { createManifest, verifyAttachmentFiles } from '../lib/seal/manifest.js';
import { createSealPdf } from '../lib/seal/pdf.js';
import { bundleVerifier, sealSignatureData, verifySeal } from '../lib/seal/verify.js';
import { credentialsValid, requireSigningCredentials, resetSigningFailures, signWithUser, signaturePayload, reviewerMessage, verifySignature } from '../lib/signing/index.js';
import { canonicalize, sha256 } from '../lib/canonical.js';
import { getTimestampProvider } from '../lib/timestamp/index.js';
import { appendAudit } from '../lib/audit.js';
import { processSealTimestamp } from '../lib/seal/worker.js';
import { runBackground } from '../lib/background.js';
import { reviewerAllowed } from '../lib/note-permissions.js';
import { deliverNotifications } from '../lib/notifications.js';
import { put as putStored, remove as removeStored, openFile } from '../lib/storage/index.js';
import { enqueueWebhookEvent } from '../lib/webhooks.js';
const router = express.Router();
router.use(auth);
const editable = (n) => {
  if (!['진행중', '반려'].includes(n.status))
    fail(409, '승인대기 또는 승인된 노트는 수정·삭제할 수 없습니다.');
};
const sealSummary = (seal) => seal ? { sealHash: seal.sealHash, timestampStatus: seal.timestamp?.status, verifyId: seal.verifyId } : null;
async function noteResponse(note) {
  const seal = await NoteSeal.findOne({ noteId: note._id }).sort({ createdAt: -1 });
  const presence = await NotePresence.find({ noteId: note._id, expiresAt: { $gt: new Date() } }).select('userId name');
  return { ...serialize(note), ...readContent(note), amendsNoteId: note.amendsNoteId ? String(note.amendsNoteId) : null, amendmentNo: note.amendmentNo || null, amendmentReason: note.amendmentReason || null, supersededBy: note.supersededBy ? String(note.supersededBy) : null, seal: sealSummary(seal), editors: presence.map((p) => ({ id: String(p.userId), name: p.name })) };
}
async function noteResponses(notes) {
  const ids = notes.map((note) => note._id);
  const seals = await NoteSeal.find({ noteId: { $in: ids } }).sort({ createdAt: -1 }).lean();
  const byNote = new Map();
  for (const seal of seals) if (!byNote.has(String(seal.noteId))) byNote.set(String(seal.noteId), sealSummary(seal));
  return notes.map((note) => ({ ...serialize(note), amendsNoteId: note.amendsNoteId ? String(note.amendsNoteId) : null, amendmentNo: note.amendmentNo || null, amendmentReason: note.amendmentReason || null, supersededBy: note.supersededBy ? String(note.supersededBy) : null, seal: byNote.get(String(note._id)) || null }));
}
async function currentSigner(req, session, password) {
  const user = await User.findById(req.user.id).session(session);
  if (!(await credentialsValid(user, password, req.body.totp))) fail(401, '서명 비밀번호 또는 인증 코드가 만료되었거나 일치하지 않습니다.');
  await resetSigningFailures(user._id, session);
  return user;
}
function verificationUrl(verifyId) {
  const base = (process.env.PUBLIC_BASE_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0]).replace(/\/$/, '');
  return `${base}/verify/${verifyId}`;
}
function retentionDate(note, project) {
  const years = Number(process.env.RETENTION_YEARS || 30);
  if (!Number.isInteger(years) || years < 1 || years > 100) fail(500, '보존 연도 설정을 확인해주세요.');
  const date = project?.endDate ? new Date(project.endDate) : new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date;
}
function fields(body) {
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 20))
    fail(400, '태그는 최대 20개입니다.');
  return {
    title: text(body.title, '제목'),
    ...parseWriteContent(body),
    tags: [...new Set((body.tags || []).map((t) => text(t, '태그', 40)))],
    projectId: body.projectId || null,
    experimentId: body.experimentId || null,
  };
}
export async function snapshot(req, note, reason, session) {
  const snapshot = note.toObject();
  delete snapshot.content;
  delete snapshot.contentDoc;
  await ElnVersion.create(
    [
      {
        noteId: note._id,
        version: note.version,
        title: note.title,
        content: note.content,
        contentFormat: note.contentFormat || 'html',
        contentDoc: note.contentDoc,
        reagentsUsed: note.reagentsUsed,
        snapshot,
        updatedBy: req.user.id,
        updaterName: req.user.name,
        changeReason: reason,
      },
    ],
    { session },
  );
}
function versionSnapshot(value) {
  const snapshot = value?.toObject ? value.toObject() : { ...value };
  delete snapshot.content;
  delete snapshot.contentDoc;
  return snapshot;
}
function pageNumber(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (fallback === 0 ? 0 : 1)) fail(400, '페이지 또는 버전 값이 올바르지 않습니다.');
  return number;
}
async function resolveExperiment(projectId, experimentId, session) {
  if (!experimentId) return null;
  if (!projectId) fail(400, '실험은 프로젝트 노트에만 연결할 수 있습니다.');
  const rawId = typeof experimentId === 'string' ? experimentId : (mongoose.isObjectIdOrHexString(experimentId) ? String(experimentId) : experimentId);
  const experiment = await Experiment.findOne({ _id: objectId(rawId), projectId, isDeleted: false }).session(session);
  if (!experiment) fail(400, '실험이 노트 프로젝트에 속하지 않습니다.');
  return experiment._id;
}
async function resolveEntitiesUsed(supplied, projectId, session) {
  if (!Array.isArray(supplied) || supplied.length > 100) fail(400, '사용 장비·시료 목록을 확인해주세요.');
  const seen = new Set(), snapshots = [];
  for (const entry of supplied) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some((key) => key !== 'entityId')) fail(400, '개체 ID만 지정할 수 있습니다.');
    const entityId = objectId(entry.entityId);
    if (seen.has(entityId)) fail(400, '같은 개체를 중복 지정할 수 없습니다.');
    seen.add(entityId);
    const entity = await Entity.findOne({ _id: entityId, isDeleted: false }).session(session);
    if (!entity) fail(400, '사용할 개체를 찾을 수 없습니다.');
    if (entity.projectId && String(entity.projectId) !== String(projectId || '')) fail(403, '노트 프로젝트의 개체만 사용할 수 있습니다.');
    const type = await EntityType.findOne({ _id: entity.typeId, isDeleted: false }).session(session);
    if (!type) fail(400, '개체 유형을 찾을 수 없습니다.');
    snapshots.push({ entityId: entity._id, code: entity.code, name: entity.name, typeName: type.name });
  }
  return snapshots;
}
async function resolveAiRuns(supplied, userId, session = null) {
  if (supplied === undefined) return undefined;
  if (!Array.isArray(supplied) || supplied.length > 20) fail(400, 'AI 실행 이력을 확인해주세요.');
  const ids = [...new Set(supplied.map((id) => new mongoose.Types.ObjectId(objectId(id)).toString()))];
  if (!ids.length) return [];
  const query = AiRun.find({ _id: { $in: ids }, userId, feature: { $in: ['draftNote', 'generateProtocol', 'extractTables'] } });
  const runs = await query.session(session).lean();
  if (runs.length !== ids.length) fail(400, '사용할 수 없는 AI 실행 이력입니다.');
  const byId = new Map(runs.map((run) => [String(run._id), run]));
  return ids.map((id) => {
    const run = byId.get(String(id));
    return {
      runId: String(run._id),
      feature: run.feature,
      model: run.provenance.model,
      outputSha256: run.provenance.outputSha256,
      createdAt: run.createdAt,
    };
  });
}
function mergeAiRuns(existing = [], additions = []) {
  const byId = new Map(existing.map((run) => [String(run.runId), run.toObject ? run.toObject() : run]));
  for (const run of additions) if (!byId.has(run.runId)) byId.set(run.runId, run);
  return [...byId.values()];
}
async function noteLineage(noteId, session) {
  const ids = [String(noteId)];
  let currentId = String(noteId);
  while (ids.length < 100) {
    const note = await ElnNote.findById(currentId).select('amendsNoteId').session(session || null).lean();
    if (!note?.amendsNoteId) break;
    currentId = String(note.amendsNoteId);
    if (ids.includes(currentId)) break;
    ids.push(currentId);
  }
  return ids;
}
async function noteAttachments(note, session = null, projection = null) {
  const noteIds = await noteLineage(note._id, session);
  const query = FileAttachment.find({ noteId: { $in: noteIds }, isDeleted: false });
  if (projection) query.select(projection);
  return query.sort({ _id: 1 }).session(session || null);
}
async function assertDocumentReferences(doc, noteId, session, { attachmentStatus = 400, ancestorNoteId } = {}) {
  const refs = references(doc);
  for (const id of [...refs.attachmentIds, ...refs.reagentIds]) objectId(id);
  if (refs.attachmentIds.length) {
    const noteIds = await noteLineage(noteId, session);
    if (ancestorNoteId) noteIds.push(...await noteLineage(ancestorNoteId, session));
    const attachments = await FileAttachment.find({ _id: { $in: refs.attachmentIds }, noteId: { $in: [...new Set(noteIds)] }, isDeleted: false }).session(session);
    if (attachments.length !== new Set(refs.attachmentIds).size) fail(attachmentStatus, '이미지 첨부가 이 노트에 없거나 삭제되었습니다.');
  }
  if (refs.reagentIds.length) {
    const reagents = await LimsItem.find({ _id: { $in: refs.reagentIds }, isDeleted: false }).session(session);
    if (reagents.length !== new Set(refs.reagentIds).size) fail(400, '문서가 참조한 시약을 찾을 수 없습니다.');
  }
}
async function notifyDocumentMentions(note, doc, previousDoc, actorName) {
  try {
    const previouslyMentioned = new Set(references(previousDoc || { type: 'doc', content: [] }).userIds);
    const ids = references(doc).userIds.filter((id) => mongoose.isObjectIdOrHexString(id) && id !== String(note.authorId) && !previouslyMentioned.has(id));
    if (!ids.length || !note.projectId) return;
    const project = await Project.findOne({ _id: note.projectId, isDeleted: false }).select('members').lean();
    const visible = new Set((project?.members || []).map((member) => String(member.userId)));
    const recipients = ids.filter((id) => visible.has(id));
    if (recipients.length) await deliverNotifications(recipients, { type: 'mentioned', noteId: note._id, actorName, message: `${actorName}님이 노트에서 회원님을 언급했습니다.` });
  } catch (error) { console.error('노트 언급 알림 전송 실패:', error); }
}
router.post('/convert-html', async (req, res) => {
  if (typeof req.body.html !== 'string' || req.body.html.length > 1000000) fail(400, 'HTML은 1MB 이하 문자열이어야 합니다.');
  const { htmlToDoc } = await import('@labhub/note-format/html');
  res.json(htmlToDoc(req.body.html));
});
router.get('/', async (req, res) => {
  const page = pageNumber(req.query.page, 1), limit = pageNumber(req.query.limit, 20);
  if (limit > 100) fail(400, '페이지 크기는 100을 초과할 수 없습니다.');
  const filter = { ...(await noteFilter(req.user)), isDeleted: req.query.trash === 'true' };
  if (req.query.status) filter.status = text(req.query.status, '상태', 40);
  if (req.query.projectId) filter.projectId = objectId(req.query.projectId);
  if (req.query.experimentId) filter.experimentId = objectId(req.query.experimentId);
  const sortKey = String(req.query.sort || '-updatedAt');
  if (!['updatedAt', '-updatedAt', 'createdAt', '-createdAt', 'title', '-title'].includes(sortKey)) fail(400, '정렬 기준을 확인해주세요.');
  const sort = { [sortKey.replace(/^-/, '')]: sortKey.startsWith('-') ? -1 : 1 };
  const [notes, total] = await Promise.all([
    ElnNote.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).select('_id title author authorId status date tags projectId experimentId version isDeleted amendsNoteId amendmentNo amendmentReason supersededBy createdAt updatedAt'),
    ElnNote.countDocuments(filter),
  ]);
  const seals = await NoteSeal.find({ noteId: { $in: notes.map((n) => n._id) } }).sort({ createdAt: -1 }).lean();
  const sealByNote = new Map();
  for (const seal of seals) if (!sealByNote.has(String(seal.noteId))) sealByNote.set(String(seal.noteId), sealSummary(seal));
  const items = notes.map((note) => ({ ...serialize(note), seal: sealByNote.get(String(note._id)) || null }));
  res.json({ items, total, page, limit });
});
router.get('/:id', async (req, res) => {
  const note = await getNote(req);
  const attachments = await noteAttachments(note, null, '-path -filename');
  res.json({ ...(await noteResponse(note)), attachments });
});
router.get('/:id/export', async (req, res) => {
  let data;
  await mongoose.connection.transaction(async (session) => {
    const note = await getNote(req, { session });
    const versions = await ElnVersion.find({ noteId: note._id }).sort({ version: 1 }).session(session);
    const attachments = await noteAttachments(note, session, '-path -filename');
    const seal = await NoteSeal.findOne({ noteId: note._id }).sort({ createdAt: -1 }).session(session);
    data = { note: { ...serialize(note), seal: sealSummary(seal) }, versions, attachments };
    await audit(req, 'EXPORT', 'ELN', note, null, session, '노트 JSON 내보내기');
  });
  res
    .set('Content-Disposition', `attachment; filename="note-${data.note.id}.json"`)
    .json({
      format: 'labhub-note',
      schemaVersion: 1,
      exportedAt: new Date(),
      ...data,
    });
});
router.get('/:id/versions', async (req, res) => {
  await getNote(req);
  res.json(await ElnVersion.find({ noteId: req.params.id }).sort({ version: -1 }).select('-content -contentDoc -snapshot'));
});
router.get('/:id/versions/:version', async (req, res) => {
  await getNote(req);
  const version = pageNumber(req.params.version, 0);
  const item = await ElnVersion.findOne({ noteId: req.params.id, version });
  if (!item) fail(404, '버전 기록이 없습니다.');
  res.json(item);
});
router.post('/:id/restore-version', writer, async (req, res) => {
  if (req.body.fromVersion === undefined) fail(400, '복원할 버전을 지정해주세요.');
  const fromVersion = pageNumber(req.body.fromVersion, 1), reason = text(req.body.reason, '복원 사유', 1000);
  let note;
  await mongoose.connection.transaction(async (session) => {
    note = await getNote(req, { write: true, session });
    editable(note); checkVersion(note, req.body.version);
    const old = await ElnVersion.findOne({ noteId: note._id, version: fromVersion }).session(session);
    if (!old) fail(404, '버전 기록이 없습니다.');
    const before = note.toObject(), oldSnap = old.snapshot || old.toObject();
    const format = old.contentFormat || oldSnap.contentFormat || 'html';
    const doc = format === 'doc' ? (old.contentDoc || oldSnap.contentDoc) : readContent({ content: old.content ?? oldSnap.content, contentFormat: 'html' }).contentDoc;
    const normalized = validateAndNormalizeDoc(doc);
    await assertDocumentReferences(normalized, note._id, session, { attachmentStatus: 409 });
    await snapshot(req, note, reason, session);
    note.title = old.title || oldSnap.title;
    note.contentFormat = format;
    note.contentDoc = format === 'doc' ? normalized : undefined;
    note.content = format === 'doc' ? (await import('@labhub/note-format')).docToSafeHtml(normalized) : (old.content ?? oldSnap.content ?? '');
    note.version += 1;
    await note.save({ session });
    await audit(req, 'RESTORE_VERSION', 'ELN', note, before, session, reason);
  });
  await indexNoteAfterCommit(note);
  res.json(await noteResponse(note));
});
router.post('/:id/presence', async (req, res) => {
  const note = await getNote(req, { write: true });
  const expiresAt = new Date(Date.now() + 60_000);
  await NotePresence.findOneAndUpdate({ noteId: note._id, userId: req.user.id }, { $set: { name: req.user.name, expiresAt } }, { upsert: true, returnDocument: 'after' });
  res.json({ expiresAt });
});
router.get('/:id/seal', async (req, res) => {
  const note = await getNote(req);
  const seal = await NoteSeal.findOne({ noteId: note._id }).sort({ createdAt: -1 });
  if (!seal) fail(404, '이 노트에는 봉인이 없습니다.');
  const data = seal.toObject();
  delete data.pdfPath;
  delete data.storageKey;
  res.json(data);
});
router.get('/:id/seal/verify', async (req, res) => {
  const note = await getNote(req);
  const seal = await NoteSeal.findOne({ noteId: note._id }).sort({ createdAt: -1 });
  if (!seal) fail(404, '이 노트에는 봉인이 없습니다.');
  res.json(await verifySeal(seal));
});
router.get('/:id/seal/pdf', async (req, res) => {
  let seal;
  await mongoose.connection.transaction(async (session) => {
    const note = await getNote(req, { session });
    seal = await NoteSeal.findOne({ noteId: note._id }).sort({ createdAt: -1 }).session(session);
    if (!seal) fail(404, '이 노트에는 봉인이 없습니다.');
    await audit(req, 'EXPORT', 'SEAL', seal, null, session, '봉인 PDF 다운로드');
  });
  res.set('Cache-Control', 'private, no-store').type('application/pdf').attachment(`note-${seal.noteId}-v${seal.noteVersion}.pdf`);
  (await openFile(seal)).pipe(res);
});
router.get('/:id/seal/bundle', async (req, res) => {
  let seal;
  await mongoose.connection.transaction(async (session) => {
    const note = await getNote(req, { session });
    seal = await NoteSeal.findOne({ noteId: note._id }).sort({ createdAt: -1 }).session(session);
    if (!seal) fail(404, '이 노트에는 봉인이 없습니다.');
    await audit(req, 'EXPORT', 'SEAL', seal, null, session, '증빙 ZIP 다운로드');
  });
  const signatures = seal.signatures.map((item) => item.toObject ? item.toObject() : item);
  const envelope = { manifest: seal.manifest, manifestSha256: seal.manifestSha256, pdfSha256: seal.pdfSha256, sealHash: seal.sealHash, verifyId: seal.verifyId };
  const keys = signatures.map(({ role, userId, name, keyId, algorithm, publicKey }) => ({ role, userId, name, keyId, algorithm, publicKey }));
  const readme = `LabHub 증빙 패키지\n\nmanifest.json의 manifestSha256와 pdfSha256를 로컬 검증 스크립트로 확인하세요. timestamp.tsr가 있으면 RFC 3161 토큰의 대상은 sealHash입니다.\n\nnode verify.mjs\nopenssl ts -verify -in timestamp.tsr -digest ${seal.sealHash} -CAfile tsa-ca.pem\n\nOpenSSL 검증에는 발급기관이 제공한 TSA 루트 인증서가 필요합니다. 이 패키지에는 봉인된 원본 PDF, 매니페스트, 서명과 공개키가 포함됩니다.\n`;
  res.set('Content-Type', 'application/zip').set('Content-Disposition', `attachment; filename="evidence-${seal.noteId}-v${seal.noteVersion}.zip"`).set('Cache-Control', 'private, no-store');
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (error) => res.destroy(error));
  archive.pipe(res);
  archive.append(await openFile(seal), { name: 'note.pdf' });
  archive.append(JSON.stringify(envelope, null, 2), { name: 'manifest.json' });
  archive.append(JSON.stringify(signatures, null, 2), { name: 'signatures.json' });
  archive.append(JSON.stringify(keys, null, 2), { name: 'public-keys.json' });
  if (seal.timestamp.tokenBase64) archive.append(Buffer.from(seal.timestamp.tokenBase64, 'base64'), { name: 'timestamp.tsr' });
  archive.append(bundleVerifier(), { name: 'verify.mjs' });
  archive.append(readme, { name: 'README.txt' });
  await archive.finalize();
});
router.post('/:id/seal/timestamp/retry', async (req, res) => {
  const note = await getNote(req);
  if (!(await reviewerAllowed(note, req.user))) fail(403, '점검자 권한이 필요합니다.');
  let seal;
  await mongoose.connection.transaction(async (session) => {
    seal = await NoteSeal.findOne({ noteId: note._id }).sort({ createdAt: -1 }).session(session);
    if (!seal) fail(404, '이 노트에는 봉인이 없습니다.');
    if (seal.timestamp.status === 'granted') fail(409, '시점인증이 이미 완료되었습니다.');
    seal.timestamp = { ...(seal.timestamp.toObject?.() || seal.timestamp), status: 'pending', provider: process.env.TIMESTAMP_PROVIDER || seal.timestamp.provider || 'none', nextAttemptAt: new Date(), lockId: undefined, lockedAt: undefined, lastError: undefined };
    await seal.save({ session });
    await audit(req, 'TIMESTAMP', 'SEAL', seal, null, session, '시점인증 재요청');
  });
  runBackground(() => processSealTimestamp(seal._id), '시점인증 재시도 작업 오류');
  res.json({ success: true, timestampStatus: 'pending' });
});
router.post('/', writer, async (req, res) => {
  const data = fields(req.body);
  const aiRuns = await resolveAiRuns(req.body.aiRunIds, req.user.id);
  if (aiRuns !== undefined) data.aiRuns = aiRuns;
  const requestId = req.body.requestId;
  const requestPayload = { ...data, reagentsUsed: req.body.reagentsUsed || [], entitiesUsed: req.body.entitiesUsed || [] };
  if (aiRuns !== undefined) requestPayload.aiRunIds = aiRuns.map((run) => run.runId);
  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(requestPayload))
    .digest('hex');
  if (
    requestId !== undefined &&
    (typeof requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(requestId))
  )
    fail(400, '잘못된 저장 요청 ID입니다.');
  if (requestId) {
    const existing = await ElnNote.findOne({ authorId: req.user.id, requestId });
    if (existing) {
      if (existing.requestHash !== requestHash)
        fail(
          409,
          '이 초안의 이전 내용이 이미 저장되었습니다. 최신 노트를 열어 수정해주세요. 기기 초안은 유지됩니다.',
        );
      req.params.id = String(existing._id);
      await getNote(req);
      return res.json(serialize(existing));
    }
  }
  let note;
  try {
    await mongoose.connection.transaction(async (session) => {
      await projectAccess(req.user, data.projectId, true, session);
      data.experimentId = await resolveExperiment(data.projectId, data.experimentId, session);
      data.entitiesUsed = await resolveEntitiesUsed(req.body.entitiesUsed || [], data.projectId, session);
      note = new ElnNote({
        ...data,
        requestId,
        requestHash,
        authorId: req.user.id,
        author: req.user.name,
        date: new Date().toISOString().slice(0, 10),
      });
      note.protocolRun = await createProtocolRun(req.body.protocolId, req.body.protocolVersion, data.projectId, req.user, session);
      await assertDocumentReferences(note.contentDoc || readContent(note).contentDoc, note._id, session);
      note.reagentsUsed = await adjustReagents(req, note, [], req.body.reagentsUsed || [], session);
      await note.save({ session });
      await audit(req, 'CREATE', 'ELN', note, null, session);
    });
  } catch (error) {
    if (error.code !== 11000 || !requestId) throw error;
    note = await ElnNote.findOne({ authorId: req.user.id, requestId });
    if (!note) throw error;
    if (note.requestHash !== requestHash)
      fail(409, '이미 저장된 요청입니다. 최신 노트를 열어 수정해주세요.');
    req.params.id = String(note._id);
    await getNote(req);
  }
  await indexNoteAfterCommit(note);
  await notifyDocumentMentions(note, note.contentFormat === 'doc' ? note.contentDoc : readContent(note).contentDoc, null, req.user.name);
  res.status(201).json(await noteResponse(note));
});
router.put('/:id', writer, async (req, res) => {
  const data = fields(req.body),
    reason = text(req.body.changeReason, '수정 사유', 1000);
  let note, previousDoc;
  await mongoose.connection.transaction(async (session) => {
    note = await getNote(req, { write: true, session });
    editable(note);
    checkVersion(note, req.body.version);
    await projectAccess(req.user, data.projectId, true, session);
    if (
      String(note.projectId || '') !== String(data.projectId || '') &&
      req.user.role !== 'admin' &&
      String(note.authorId) !== req.user.id
    )
      fail(403, '프로젝트 이동은 작성자 또는 관리자만 가능합니다.');
    const before = note.toObject();
    previousDoc = note.contentFormat === 'doc' ? note.contentDoc : readContent(note).contentDoc;
    Object.assign(data, parseWriteContent(req.body, note));
    const requestedExperiment = req.body.experimentId !== undefined
      ? req.body.experimentId
      : (String(note.projectId || '') === String(data.projectId || '') ? note.experimentId : null);
    data.experimentId = await resolveExperiment(data.projectId, requestedExperiment, session);
    data.entitiesUsed = await resolveEntitiesUsed(req.body.entitiesUsed ?? (note.entitiesUsed || []).map((item) => ({ entityId: String(item.entityId) })), data.projectId, session);
    const nextDoc = data.contentFormat === 'doc' ? data.contentDoc : readContent({ content: data.content, contentFormat: 'html' }).contentDoc;
    await assertDocumentReferences(nextDoc, note._id, session);
    await snapshot(req, note, reason, session);
    note.reagentsUsed = await adjustReagents(
      req,
      note,
      note.reagentsUsed,
      req.body.reagentsUsed ??
        note.reagentsUsed.map((r) => ({ ...r.toObject(), reagentId: String(r.reagentId) })),
      session,
    );
    Object.assign(note, data);
    if (req.body.aiRunIds !== undefined) {
      const aiRuns = await resolveAiRuns(req.body.aiRunIds, req.user.id, session);
      note.aiRuns = mergeAiRuns(note.aiRuns, aiRuns);
    }
    if (req.body.protocolRun) {
      if (!note.protocolRun || String(req.body.protocolRun.protocolId) !== String(note.protocolRun.protocolId) || Number(req.body.protocolRun.version) !== Number(note.protocolRun.version)) fail(400, '프로토콜 실행 스냅샷은 변경할 수 없습니다.');
      if (req.body.protocolRun.snapshot && canonicalize(req.body.protocolRun.snapshot) !== canonicalize(note.protocolRun.snapshot)) fail(400, '프로토콜 실행 스냅샷은 변경할 수 없습니다.');
      if (req.body.protocolRun.stepResults !== undefined) note.protocolRun.stepResults = validateProtocolStepResults(note.protocolRun.snapshot, req.body.protocolRun.stepResults);
    } else if (req.body.protocolRun !== undefined && note.protocolRun) {
      fail(400, '프로토콜 실행 기록은 삭제할 수 없습니다.');
    }
    note.version += 1;
    note.status = '진행중';
    await note.save({ session });
    await audit(req, 'UPDATE', 'ELN', note, before, session, reason);
  });
  await indexNoteAfterCommit(note);
  await notifyDocumentMentions(note, note.contentFormat === 'doc' ? note.contentDoc : readContent(note).contentDoc, previousDoc, req.user.name);
  res.json(await noteResponse(note));
});
async function transition(req, action, change, options = {}) {
  let note;
  await mongoose.connection.transaction(async (session) => {
    note = await getNote(req, { write: true, session, ...options });
    checkVersion(note, req.body.version);
    const before = note.toObject();
    await change(note, session);
    if (before.status !== note.status && ['승인됨', '반려'].includes(note.status)) {
      const event = note.status === '승인됨' ? 'note.approved' : 'note.rejected';
      await enqueueWebhookEvent(event, { noteId: String(note._id), title: note.title, version: note.version, status: note.status }, session);
    }
    await ElnVersion.create(
      [
        {
          noteId: note._id,
          version: before.version,
          title: before.title,
          content: before.content,
          contentFormat: before.contentFormat || 'html',
          contentDoc: before.contentDoc,
          reagentsUsed: before.reagentsUsed,
          snapshot: versionSnapshot(before),
          updaterName: req.user.name,
          updatedBy: req.user.id,
          changeReason: action,
        },
      ],
      { session },
    );
    note.version += 1;
    await note.save({ session });
    await audit(req, action, 'ELN', note, before, session);
  });
  await indexNoteAfterCommit(note);
  return noteResponse(note);
}
router.delete('/:id', writer, async (req, res) =>
  res.json(
    await transition(req, 'DELETE', async (n, session) => {
      editable(n);
      n.isDeleted = true;
      if (n.amendsNoteId && n.status !== '승인됨') {
        const original = await ElnNote.findOne({ _id: n.amendsNoteId }).session(session);
        if (original && String(original.supersededBy || '') === String(n._id)) {
          const before = original.toObject();
          await snapshot(req, original, '미승인 개정판 삭제', session);
          original.supersededBy = undefined;
          original.version += 1;
          await original.save({ session });
          await audit(req, 'AMEND', 'ELN', original, before, session, '미승인 개정판 연결 해제');
        }
      }
    }),
  ),
);
router.post('/:id/restore', writer, async (req, res) =>
  res.json(
    await transition(
      req,
      'RESTORE',
      async (n, session) => {
        if (n.amendsNoteId) {
          const original = await ElnNote.findById(n.amendsNoteId).session(session);
          if (!original || original.isDeleted) fail(409, '원본 노트를 복원할 수 없습니다.');
          if (original.supersededBy && String(original.supersededBy) !== String(n._id))
            fail(409, '원본에 다른 개정판이 연결되어 있습니다.');
          const competing = await ElnNote.findOne({ amendsNoteId: original._id, isDeleted: false, _id: { $ne: n._id } }).session(session);
          if (competing) fail(409, '원본에 다른 개정판이 존재합니다.');
          if (!original.supersededBy) {
            const before = original.toObject();
            await snapshot(req, original, '개정판 복원', session);
            original.supersededBy = n._id;
            original.version += 1;
            await original.save({ session });
            await audit(req, 'AMEND', 'ELN', original, before, session, '개정판 복원 연결');
          }
        }
        n.isDeleted = false;
      },
      { deleted: true },
    ),
  ),
);
router.post('/:id/request-approval', writer, async (req, res) => {
  const { password } = await requireSigningCredentials(req);
  const note = await transition(req, 'REQUEST_APPROVAL', async (n, session) => {
    editable(n);
    if (String(n.authorId) !== req.user.id) fail(403, '작성자 본인만 서명 요청을 할 수 있습니다.');
    if (!hasDocumentContent(n.contentFormat === 'doc' ? n.contentDoc : readContent(n).contentDoc)) fail(400, '연구 내용을 작성한 후 승인을 요청해주세요.');
    const signer = await currentSigner(req, session, password);
    const files = await noteAttachments(n, session);
    await verifyAttachmentFiles(files);
    const { manifest, manifestSha256 } = await createManifest(n, files, { version: n.version });
    const signature = await signWithUser(signer, password, manifestSha256, session);
    const authorSignature = { userId: signer._id, name: signer.name, email: signer.email, ...signature, manifestSha256, version: n.version };
    n.pendingAuthorSignature = { manifest, manifestSha256, noteVersion: n.version, signature: authorSignature };
    n.signatures.push({ ...signaturePayload(signature, { role: 'author', user: signer, manifestSha256, version: n.version, decision: 'request' }), email: signer.email });
    n.status = '승인대기';
  });
  const project = note.projectId ? await Project.findById(note.projectId).select('members').lean() : null;
  const reviewers = (project?.members || []).filter((member) => member.role === 'manager').map((member) => String(member.userId));
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
  const candidates = [...new Set([...reviewers, ...admins.map((user) => String(user._id))])].filter((id) => id !== req.user.id);
  const eligible = await User.find({ _id: { $in: candidates }, role: { $ne: 'viewer' }, isActive: true }).select('_id').lean();
  await deliverNotifications(eligible.map((user) => String(user._id)), { type: 'approval-requested', noteId: note._id, actorName: req.user.name, message: `${req.user.name}님이 노트 승인을 요청했습니다.` });
  res.json(await noteResponse(note));
});

router.post('/:id/cancel-approval', writer, async (req, res) => {
  const current = await getNote(req);
  if (current.status !== '승인대기') fail(409, '승인대기 노트만 요청 취소할 수 있습니다.');
  if (String(current.authorId) !== req.user.id && !(await reviewerAllowed(current, req.user))) fail(403, '작성자 또는 점검자만 요청을 취소할 수 있습니다.');
  const note = await transition(req, 'CANCEL_APPROVAL', (n) => {
    if (n.status !== '승인대기') fail(409, '승인대기 노트만 요청 취소할 수 있습니다.');
    for (const signature of n.signatures) if (signature.role === 'author' && signature.version === n.pendingAuthorSignature?.noteVersion && signature.isValid !== false) {
      signature.isValid = false; signature.invalidatedAt = new Date();
    }
    n.pendingAuthorSignature = undefined;
    n.status = '진행중';
  });
  res.json(await noteResponse(note));
});

async function reviewDecision(req, res, decision) {
  const { password } = await requireSigningCredentials(req);
  const comment = text(req.body.comment || '', '검토 의견', 2000, decision === 'reject');
  let pdfPath, storageKey;
  let sealId;
  try {
    const note = await transition(req, decision === 'approve' ? 'SIGN' : 'REJECT', async (n, session) => {
      if (n.status !== '승인대기') fail(409, '승인대기 상태에서만 검토할 수 있습니다.');
      if (String(n.authorId) === req.user.id) fail(403, '작성자 본인은 점검할 수 없습니다.');
      const reviewer = await currentSigner(req, session, password);
      if (!(await reviewerAllowed(n, req.user, session))) fail(403, '해당 프로젝트의 점검자 권한이 필요합니다.');
      const pending = n.pendingAuthorSignature;
      if (!pending) fail(409, '작성자 서명이 없는 노트는 검토할 수 없습니다.');
      const files = await noteAttachments(n, session);
      await verifyAttachmentFiles(files);
      const current = await createManifest(n, files, { version: pending.noteVersion });
      if (current.manifestSha256 !== pending.manifestSha256 || canonicalize(current.manifest) !== canonicalize(pending.manifest))
        fail(409, '작성자 서명 이후 노트 또는 첨부 내용이 변경되었습니다.');
      const author = pending.signature;
      if (!verifySignature(author.publicKey, pending.manifestSha256, author.signature)) fail(409, '작성자 서명이 유효하지 않습니다.');
      const reviewerSig = await signWithUser(reviewer, password, reviewerMessage(pending.manifestSha256, author.signature), session);
      const reviewerSignature = { userId: reviewer._id, name: reviewer.name, email: reviewer.email, ...reviewerSig, manifestSha256: pending.manifestSha256, version: pending.noteVersion };
      n.signatures.push({ ...signaturePayload(reviewerSig, { role: 'reviewer', user: reviewer, comment, manifestSha256: pending.manifestSha256, version: pending.noteVersion, decision }), email: reviewer.email });
      if (decision === 'reject') {
        n.status = '반려';
        n.pendingAuthorSignature = undefined;
        return;
      }
      const sealSignatures = [
        { role: 'author', userId: author.userId, name: author.name, keyId: author.keyId, algorithm: author.algorithm, publicKey: author.publicKey, signature: author.signature, signedAt: author.signedAt },
        { role: 'reviewer', userId: reviewerSignature.userId, name: reviewerSignature.name, keyId: reviewerSignature.keyId, algorithm: reviewerSignature.algorithm, publicKey: reviewerSignature.publicKey, signature: reviewerSignature.signature, signedAt: reviewerSignature.signedAt, comment },
      ];
      const verifyId = crypto.randomBytes(16).toString('base64url');
      pdfPath = await createSealPdf({ noteId: n._id, version: pending.noteVersion, manifest: current.manifest, manifestSha256: pending.manifestSha256, signatures: sealSignatures, verifyUrl: verificationUrl(verifyId), attachmentFiles: files });
      const pdfHash = crypto.createHash('sha256');
      for await (const chunk of createReadStream(pdfPath)) pdfHash.update(chunk);
      const pdfSha256 = pdfHash.digest('hex');
      storageKey = await putStored(createReadStream(pdfPath), { key: `seals/${n._id}-${pending.noteVersion}-${crypto.randomUUID()}.pdf`, contentType: 'application/pdf' });
      const sealHash = sha256(canonicalize({ manifestSha256: pending.manifestSha256, pdfSha256, signatures: sealSignatureData(sealSignatures) }));
      const provider = getTimestampProvider();
      const timestampStatus = ['none', 'enote-portal'].includes(provider.name) ? 'not_configured' : 'pending';
      const project = n.projectId ? await Project.findById(n.projectId).session(session) : null;
      const [seal] = await NoteSeal.create([{
        verifyId, noteId: n._id, noteVersion: pending.noteVersion, manifest: current.manifest,
        manifestSha256: pending.manifestSha256, storageKey, pdfSha256, signatures: sealSignatures,
        sealHash, timestamp: { provider: provider.name, status: timestampStatus, attempts: 0, requestedAt: new Date(), nextAttemptAt: new Date(), isTrusted: provider.isTrusted },
        retainUntil: retentionDate(n, project), createdAt: new Date(),
      }], { session });
      sealId = seal._id;
      await audit(req, 'SEAL', 'SEAL', seal, null, session, `노트 봉인 생성: ${String(n._id)} v${pending.noteVersion}`);
      n.status = '승인됨';
      n.pendingAuthorSignature = undefined;
    });
    if (sealId) runBackground(() => processSealTimestamp(sealId), '봉인 시점인증 작업 오류');
    await deliverNotifications([note.authorId], { type: decision === 'approve' ? 'approved' : 'rejected', noteId: note._id, actorName: req.user.name, message: `${req.user.name}님이 노트를 ${decision === 'approve' ? '승인했습니다.' : '반려했습니다.'}` });
    res.json(await noteResponse(note));
  } catch (error) {
    if (pdfPath) await unlink(pdfPath).catch(() => {});
    if (storageKey && !sealId) await removeStored(storageKey).catch(() => {});
    throw error;
  }
}

for (const decision of ['approve', 'reject']) router.post(`/:id/${decision}`, (req, res) => reviewDecision(req, res, decision));

router.post('/:id/amend', writer, async (req, res) => {
  const reason = text(req.body.reason, '정정 사유', 2000);
  let amendment;
  await mongoose.connection.transaction(async (session) => {
    const original = await getNote(req, { write: true, session });
    if (original.status !== '승인됨') fail(409, '승인된 노트만 정정할 수 있습니다.');
    if (original.supersededBy) fail(409, '이미 개정판이 연결된 노트입니다.');
    const existing = await ElnNote.findOne({ amendsNoteId: original._id, isDeleted: false, status: { $in: ['진행중', '반려', '승인대기'] } }).session(session);
    if (existing) fail(409, '미승인 개정판이 이미 있습니다.');
    amendment = new ElnNote({
      authorId: req.user.id, author: req.user.name, title: original.title, content: original.content,
      contentFormat: original.contentFormat || 'html', contentDoc: original.contentDoc,
      experimentId: original.experimentId, protocolRun: original.protocolRun,
      tags: [...original.tags], projectId: original.projectId, status: '진행중', version: 1,
      reagentsUsed: [], amendsNoteId: original._id, amendmentReason: reason,
      amendmentNo: (original.amendmentNo || 0) + 1, date: new Date().toISOString().slice(0, 10),
    });
    if (amendment.contentFormat === 'doc') await assertDocumentReferences(amendment.contentDoc, amendment._id, session, { ancestorNoteId: original._id });
    await amendment.save({ session });
    const before = original.toObject();
    await snapshot(req, original, '승인 후 정정 연결', session);
    original.supersededBy = amendment._id;
    original.version += 1;
    await original.save({ session });
    await audit(req, 'AMEND', 'ELN', amendment, null, session, `승인 후 정정: ${reason}`);
    await audit(req, 'AMEND', 'ELN', original, before, session, `개정판 ${String(amendment._id)} 연결`);
  });
  await indexNoteAfterCommit(amendment);
  await indexNoteAfterCommit(await ElnNote.findById(amendment.amendsNoteId));
  res.status(201).json(await noteResponse(amendment));
});
export default router;
