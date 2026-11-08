import express from 'express';
import Busboy from 'busboy';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import FileAttachment from '../models/FileAttachment.js';
import { auth, writer } from '../middleware/auth.js';
import { getNote, objectId, fail, checkVersion, audit } from '../lib/core.js';
import { snapshot } from './eln.js';
import { references, readContent } from '../lib/note-doc.js';
import { put, remove, openFile } from '../lib/storage/index.js';

const router = express.Router();
router.use(auth);
function uploadLimit() {
  const mb = Number(process.env.MAX_UPLOAD_MB || 200);
  if (!Number.isFinite(mb) || mb < 1 || mb > 2048) fail(500, 'MAX_UPLOAD_MB 설정을 확인해주세요.');
  return mb * 1024 * 1024;
}
async function parseUpload(req, target) {
  const max = uploadLimit();
  const fields = {};
  const hash = crypto.createHash('sha256');
  let size = 0, originalName = '', mimeType = 'application/octet-stream', fileSeen = false, fileError = null;
  let fileDone = Promise.resolve();
  await new Promise((resolve, reject) => {
    let parser;
    try { parser = Busboy({ headers: req.headers, defCharset: 'utf8', defParamCharset: 'utf8', limits: { fileSize: max, files: 1, fields: 4, fieldSize: 4096 } }); }
    catch { return reject(Object.assign(new Error('multipart/form-data 형식을 확인해주세요.'), { status: 400 })); }
    parser.on('field', (name, value, info) => {
      if (info.valueTruncated) fileError = Object.assign(new Error('요청 항목이 너무 깁니다.'), { status: 400 });
      else fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      if (name !== 'file' || fileSeen) {
        fileError = Object.assign(new Error('파일 항목을 확인해주세요.'), { status: 400 });
        stream.resume(); return;
      }
      fileSeen = true;
      originalName = path.basename(info.filename || 'upload').slice(0, 255);
      mimeType = info.mimeType || mimeType;
      const meter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
      stream.on('limit', () => { fileError = Object.assign(new Error('파일 크기가 제한을 초과했습니다.'), { status: 413 }); });
      fileDone = pipeline(stream, meter, createWriteStream(target, { flags: 'wx' })).catch((error) => { fileError ||= error; });
    });
    parser.on('filesLimit', () => { fileError = Object.assign(new Error('파일은 한 개만 업로드할 수 있습니다.'), { status: 400 }); });
    parser.on('fieldsLimit', () => { fileError = Object.assign(new Error('요청 항목이 너무 많습니다.'), { status: 400 }); });
    parser.on('error', reject);
    parser.on('finish', resolve);
    req.pipe(parser);
  });
  await fileDone;
  if (fileError) throw fileError;
  if (!fileSeen) fail(400, '파일을 선택해주세요.');
  return { fields, size, sha256: hash.digest('hex'), originalName, mimeType };
}

router.post('/upload', writer, async (req, res) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'labhub-upload-'));
  const tempPath = path.join(dir, 'upload');
  let storageKey;
  try {
    const uploaded = await parseUpload(req, tempPath);
    const noteId = objectId(uploaded.fields.noteId);
    req.params.id = noteId;
    await getNote(req, { write: true });
    storageKey = await put(createReadStream(tempPath), { key: `attachments/${crypto.randomUUID()}`, contentType: uploaded.mimeType });
    let attachment, version;
    try {
      await mongoose.connection.transaction(async (session) => {
        const note = await getNote(req, { write: true, session });
        checkVersion(note, Number(uploaded.fields.version));
        if (!['진행중', '반려'].includes(note.status)) fail(409, '검토 중이거나 승인된 노트의 첨부는 변경할 수 없습니다.');
        const before = note.toObject();
        await snapshot(req, note, '첨부파일 추가', session);
        [attachment] = await FileAttachment.create([{ filename: path.basename(storageKey), storageKey, originalName: uploaded.originalName, mimeType: uploaded.mimeType, size: uploaded.size, noteId, uploadedBy: req.user.id, sha256: uploaded.sha256 }], { session });
        note.version += 1; version = note.version; await note.save({ session });
        await audit(req, 'ATTACH', 'ELN', note, before, session, `첨부 추가: ${attachment.originalName}`);
      });
    } catch (error) { await remove(storageKey).catch(() => {}); throw error; }
    res.status(201).json({ file: { _id: attachment._id, originalName: attachment.originalName, size: attachment.size, sha256: attachment.sha256 }, version });
  } finally {
    await unlink(tempPath).catch(() => {}); await rmdir(dir).catch(() => {});
  }
});
router.get('/:fileId/download', async (req, res, next) => {
  try {
    const file = await FileAttachment.findOne({ _id: objectId(req.params.fileId), isDeleted: false });
    if (!file?.noteId) fail(404, '첨부파일이 없습니다.');
    req.params.id = String(file.noteId); await getNote(req);
    res.set('Cache-Control', 'private, no-store').set('Content-Type', file.mimeType).attachment(file.originalName);
    const stream = await openFile(file); stream.on('error', next); stream.pipe(res);
  } catch (error) { next(error); }
});
router.delete('/:fileId', writer, async (req, res) => {
  const fileId = objectId(req.params.fileId); let version;
  await mongoose.connection.transaction(async (session) => {
    const file = await FileAttachment.findOne({ _id: fileId, isDeleted: false }).session(session);
    if (!file?.noteId) fail(404, '첨부파일이 없습니다.');
    req.params.id = String(file.noteId); const note = await getNote(req, { write: true, session });
    checkVersion(note, req.body.version);
    const contentDoc = note.contentFormat === 'doc' ? note.contentDoc : readContent(note).contentDoc;
    if (references(contentDoc).attachmentIds.includes(String(file._id))) fail(409, '현재 노트 본문에서 사용 중인 첨부 파일입니다.');
    if (!['진행중', '반려'].includes(note.status)) fail(409, '검토 중이거나 승인된 노트의 첨부는 변경할 수 없습니다.');
    const before = note.toObject(); await snapshot(req, note, '첨부파일 삭제', session); file.isDeleted = true; await file.save({ session });
    note.version += 1; version = note.version; await note.save({ session });
    await audit(req, 'DETACH', 'ELN', note, before, session, `첨부 삭제: ${file.originalName}`);
  });
  res.json({ version });
});
export default router;
