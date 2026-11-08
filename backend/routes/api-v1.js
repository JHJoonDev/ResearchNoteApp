import express from 'express';
import Busboy from 'busboy';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import ElnNote from '../models/ElnNote.js';
import LimsItem from '../models/LimsItem.js';
import LimsLot from '../models/LimsLot.js';
import InboxFile from '../models/InboxFile.js';
import FileAttachment from '../models/FileAttachment.js';
import { apiKeyAuth, perKeyRateLimit, requireScope } from '../middleware/api-key.js';
import { getNote, noteFilter, audit, fail, objectId, checkVersion, text } from '../lib/core.js';
import { auth, writer } from '../middleware/auth.js';
import { put, remove } from '../lib/storage/index.js';
import { snapshot } from './eln.js';
import { enqueueWebhookEvent } from '../lib/webhooks.js';

export const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'LabHub 공개 API', version: '1.0.0' },
  paths: {
    '/openapi.json': { get: { operationId: 'getOpenApi', security: [{ bearerAuth: [] }], responses: { '200': { description: 'OpenAPI 3.1 스키마' } } } },
    '/notes': { get: { operationId: 'listNotes', security: [{ bearerAuth: [] }], responses: { '200': { description: '페이지 단위 노트 목록' } } } },
    '/notes/{id}': { get: { operationId: 'getNote', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '접근 가능한 노트' } } } },
    '/reagents': { get: { operationId: 'listReagents', security: [{ bearerAuth: [] }], responses: { '200': { description: '시약 목록' } } } },
    '/reagents/{id}/lots': { get: { operationId: 'listReagentLots', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '시약 로트 목록' } } } },
    '/inbox/files': { post: { operationId: 'uploadInboxFile', security: [{ bearerAuth: [] }], responses: { '201': { description: '파일 저장 완료' }, '200': { description: '중복 파일' }, '400': { description: '요청 오류' }, '401': { description: 'API 키 오류' }, '403': { description: '권한 부족' }, '408': { description: '업로드 시간 초과' }, '413': { description: '파일 크기 초과' }, '415': { description: '지원하지 않는 형식' }, '422': { description: '해시 불일치' }, '429': { description: '요청 한도 초과' }, '500': { description: '서버 오류' } } } },
  },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'lh_<prefix>_<secret>' } } },
};

const router = express.Router();
router.use(apiKeyAuth, perKeyRateLimit);
function pageParams(req) {
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, '페이지 값을 확인해주세요.');
  return { page, limit };
}
router.get('/openapi.json', (_req, res) => res.json(OPENAPI));
router.get('/notes', requireScope('notes:read'), async (req, res) => {
  const { page, limit } = pageParams(req), access = await noteFilter(req.user);
  const filter = { $and: [access, { isDeleted: false }] };
  const [items, total] = await Promise.all([ElnNote.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).select('-pendingAuthorSignature -requestHash').lean(), ElnNote.countDocuments(filter)]);
  res.json({ items: items.map((item) => ({ ...item, id: String(item._id) })), total, page, limit });
});
router.get('/notes/:id', requireScope('notes:read'), async (req, res) => {
  const id = objectId(req.params.id), access = await noteFilter(req.user);
  const note = await ElnNote.findOne({ $and: [access, { _id: id, isDeleted: false }] }).select('-pendingAuthorSignature -requestHash').lean();
  if (!note) fail(404, '노트를 찾을 수 없습니다.');
  res.json({ ...note, id: String(note._id) });
});
router.get('/reagents', requireScope('inventory:read'), async (req, res) => {
  const { page, limit } = pageParams(req), filter = { isDeleted: false };
  const [items, total] = await Promise.all([LimsItem.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), LimsItem.countDocuments(filter)]);
  res.json({ items: items.map((item) => ({ id: String(item._id), name: item.name, cas: item.cas, brand: item.brand, stockValue: item.stockValue, unit: item.unit, minimumStock: item.minimumStock, status: item.status })), total, page, limit });
});
router.get('/reagents/:id/lots', requireScope('inventory:read'), async (req, res) => {
  const id = objectId(req.params.id);
  if (!(await LimsItem.exists({ _id: id, isDeleted: false }))) fail(404, '시약을 찾을 수 없습니다.');
  const items = await LimsLot.find({ reagentId: id, isDeleted: false }).sort({ expirationDate: 1, receivedAt: 1 }).lean();
  res.json(items.map((lot) => ({ id: String(lot._id), reagentId: String(lot.reagentId), lotNumber: lot.lotNumber, supplierLot: lot.supplierLot || '', initialAmount: lot.initialAmount, remainingAmount: lot.remainingAmount, unit: lot.unit, expirationDate: lot.expirationDate || null, receivedAt: lot.receivedAt || null, status: lot.status, locationId: lot.locationId ? String(lot.locationId) : null, location: lot.location || '', version: lot.__v || 0 })));
});

function validRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[a-z]:/i.test(value)) return false;
  return value.split('/').every((part) => part && part !== '.' && part !== '..');
}
function supportedMime(value) {
  return value === 'application/octet-stream' || value === 'application/zip' || value === 'application/x-zip-compressed' || value === 'application/json' || value === 'application/pdf' || value === 'text/plain' || value === 'text/csv' || value.startsWith('image/') || value === 'application/x-hdf5' || value === 'application/x-netcdf';
}
async function parseInboxUpload(req, filePath) {
  const maxMb = Number(process.env.MAX_UPLOAD_MB || 200);
  if (!Number.isFinite(maxMb) || maxMb < 1 || maxMb > 2048) fail(500, 'MAX_UPLOAD_MB 설정을 확인해주세요.');
  const fields = {}, hash = crypto.createHash('sha256'); let size = 0, mimeType = '', fileSeen = false, parseError;
  let fileDone = Promise.resolve();
  try { await new Promise((resolve, reject) => {
    let bb;
    try { bb = Busboy({ headers: req.headers, defCharset: 'utf8', defParamCharset: 'utf8', limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 6, fieldSize: 8192 } }); }
    catch { return reject(Object.assign(new Error('multipart 형식을 확인해주세요.'), { status: 400 })); }
    bb.on('field', (name, value, info) => { if (info.valueTruncated) parseError = Object.assign(new Error('요청 항목이 너무 깁니다.'), { status: 400 }); fields[name] = value; });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || fileSeen) { parseError = Object.assign(new Error('파일 항목을 확인해주세요.'), { status: 400 }); stream.resume(); return; }
      fileSeen = true; mimeType = info.mimeType || 'application/octet-stream';
      const meter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
      stream.on('limit', () => { parseError = Object.assign(new Error('파일 크기가 제한을 초과했습니다.'), { status: 413 }); });
      fileDone = pipeline(stream, meter, createWriteStream(filePath, { flags: 'wx' })).catch((error) => { parseError ||= error; });
    });
    bb.on('filesLimit', () => { parseError = Object.assign(new Error('파일은 한 개만 업로드할 수 있습니다.'), { status: 400 }); });
    bb.on('fieldsLimit', () => { parseError = Object.assign(new Error('요청 항목이 너무 많습니다.'), { status: 400 }); });
    const timeoutMs = Number(process.env.INBOX_UPLOAD_TIMEOUT_MS || 120000);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return reject(Object.assign(new Error('업로드 제한 시간을 확인해주세요.'), { status: 500 }));
    req.setTimeout(timeoutMs, () => {
      const error = Object.assign(new Error('파일 업로드 시간이 초과되었습니다.'), { status: 408 });
      req.unpipe(bb); bb.destroy(error); req.resume();
    });
    bb.on('error', reject); bb.on('finish', resolve); req.pipe(bb);
  }); } finally { req.setTimeout(0); await fileDone; }
  await fileDone;
  if (parseError) throw parseError;
  if (!fileSeen) fail(400, '파일 항목이 필요합니다.');
  if (!supportedMime(mimeType)) fail(415, '지원하지 않는 파일 형식입니다.');
  return { fields, sha256: hash.digest('hex'), size, mimeType };
}
router.post('/inbox/files', requireScope('inbox:write'), async (req, res) => {
  if (!req.is('multipart/form-data')) fail(415, 'multipart/form-data 파일만 업로드할 수 있습니다.');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'labhub-inbox-')), filePath = path.join(tempDir, 'payload'); let storageKey;
  try {
    const uploaded = await parseInboxUpload(req, filePath), fields = uploaded.fields;
    const allowed = ['instrumentId','relativePath','sha256','capturedAt'];
    if (Object.keys(fields).some((key) => !allowed.includes(key)) || allowed.some((key) => typeof fields[key] !== 'string')) fail(400, '업로드 정보를 확인해주세요.');
    const instrumentId = text(fields.instrumentId, '장비 ID', 200), relativePath = fields.relativePath;
    if (!validRelativePath(relativePath)) fail(400, '상대 파일 경로를 확인해주세요.');
    if (!/^[a-f\d]{64}$/i.test(fields.sha256)) fail(400, 'SHA-256 값을 확인해주세요.');
    const capturedAt = new Date(fields.capturedAt);
    if (!Number.isFinite(capturedAt.getTime()) || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(fields.capturedAt)) fail(400, '촬영 시각을 확인해주세요.');
    const expectedKey = crypto.createHash('sha256').update(instrumentId + relativePath + fields.sha256.toLowerCase()).digest('hex');
    if (req.get('Idempotency-Key') !== expectedKey) fail(400, 'Idempotency-Key 값이 업로드 정보와 일치하지 않습니다.');
    if (uploaded.sha256 !== fields.sha256.toLowerCase()) return res.status(422).json({ message: '파일 SHA-256 값이 일치하지 않습니다.' });
    const existing = await InboxFile.findOne({ instrumentId, relativePath, sha256: uploaded.sha256 });
    if (existing) return res.status(200).json({ id: String(existing._id), duplicate: true });
    storageKey = await put(createReadStream(filePath), { key: `inbox/${crypto.randomUUID()}`, contentType: uploaded.mimeType });
    let inbox;
    try {
      await mongoose.connection.transaction(async (session) => {
        [inbox] = await InboxFile.create([{ instrumentId, relativePath, capturedAt, sha256: uploaded.sha256, size: uploaded.size, storageKey, uploadedByKey: req.apiKey.id }], { session });
        await audit(req, 'INBOX_UPLOAD', 'INBOX_FILE', inbox, null, session, '장비 파일 업로드');
        await enqueueWebhookEvent('inbox.received', { id: String(inbox._id), instrumentId, relativePath, sha256: uploaded.sha256, size: uploaded.size, capturedAt }, session);
      });
    } catch (error) {
      await remove(storageKey).catch(() => {});
      if (error.code === 11000) {
        const duplicate = await InboxFile.findOne({ instrumentId, relativePath, sha256: uploaded.sha256 });
        if (duplicate) return res.status(200).json({ id: String(duplicate._id), duplicate: true });
      }
      throw error;
    }
    storageKey = null;
    res.status(201).json({ id: String(inbox._id) });
  } finally {
    if (storageKey) await remove(storageKey).catch(() => {});
    await unlink(filePath).catch(() => {}); await rmdir(tempDir).catch(() => {});
  }
});

router.use((_req, res) => res.status(404).json({ message: 'API 경로를 찾을 수 없습니다.' }));
export const apiV1Router = router;
export function actualV1RouteCoverage() {
  return router.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]).map((method) => `${method.toUpperCase()} ${layer.route.path}`)).sort();
}

const inboxRouter = express.Router(); inboxRouter.use(auth);
inboxRouter.get('/', async (req, res) => {
  const { page, limit } = pageParams(req), filter = { status: { $ne: 'dismissed' } };
  const [items, total] = await Promise.all([InboxFile.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), InboxFile.countDocuments(filter)]);
  res.json({ items: items.map((item) => ({ id: String(item._id), instrumentId: item.instrumentId, relativePath: item.relativePath, capturedAt: item.capturedAt, sha256: item.sha256, size: item.size, status: item.status, noteId: item.noteId ? String(item.noteId) : null, createdAt: item.createdAt })), total, page, limit });
});
inboxRouter.post('/:id/attach', writer, async (req, res) => {
  const id = objectId(req.params.id), noteId = objectId(req.body.noteId);
  if (Object.keys(req.body).some((key) => !['noteId','version'].includes(key)) || !Number.isInteger(req.body.version)) fail(400, '노트 ID와 버전을 확인해주세요.');
  let result;
  await mongoose.connection.transaction(async (session) => {
    const inbox = await InboxFile.findOne({ _id: id, status: 'new' }).session(session); if (!inbox) fail(404, '받은 파일을 찾을 수 없습니다.');
    req.params.id = String(noteId); const note = await getNote(req, { write: true, session }); checkVersion(note, req.body.version);
    if (!['진행중','반려'].includes(note.status)) fail(409, '검토 중이거나 승인된 노트에는 파일을 붙일 수 없습니다.');
    const before = note.toObject(); await snapshot(req, note, '장비 파일 첨부', session);
    const originalName = path.posix.basename(inbox.relativePath).slice(0, 255);
    const [attachment] = await FileAttachment.create([{ filename: path.basename(inbox.storageKey), storageKey: inbox.storageKey, originalName, mimeType: 'application/octet-stream', size: inbox.size, sha256: inbox.sha256, noteId, uploadedBy: req.user.id }], { session });
    note.version += 1; await note.save({ session }); inbox.status = 'attached'; inbox.noteId = noteId; await inbox.save({ session });
    await audit(req, 'INBOX_ATTACH', 'ELN', note, before, session, `받은 파일 첨부: ${originalName}`);
    result = { file: { id: String(attachment._id), originalName: attachment.originalName, size: attachment.size, sha256: attachment.sha256 }, version: note.version };
  });
  res.status(201).json(result);
});
inboxRouter.post('/:id/dismiss', writer, async (req, res) => {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const inbox = await InboxFile.findOne({ _id: id, status: 'new' }).session(session); if (!inbox) fail(404, '받은 파일을 찾을 수 없습니다.');
    const before = inbox.toObject(); inbox.status = 'dismissed'; await inbox.save({ session }); await audit(req, 'INBOX_DISMISS', 'INBOX_FILE', inbox, before, session);
  });
  res.json({ success: true });
});
export const inboxRouterForSession = inboxRouter;
