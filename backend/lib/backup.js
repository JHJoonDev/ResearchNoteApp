import mongoose from 'mongoose';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { openFile, put, remove } from './storage/index.js';
const { EJSON } = mongoose.mongo.BSON;

const collections = [
  'users','projects','elnnotes','elnversions','elntemplates','limsitems','limslots','limstransactions',
  'fileattachments','auditlogs','auditchainheads','auditanchors','auditanchorlocks','usersigningkeys','noteseals',
  'mfaloginchallenges','experiments','protocols','protocolversions','comments','notifications','notepresences',
  'accounttokens','locations','entitytypes','entities','bookings','apikeys','inboxfiles','webhooks',
  'webhookdeliveries','oidcloginstates','airuns','setup',
];
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function copyAndHash(source, target) {
  const digest = crypto.createHash('sha256'); let size = 0;
  const meter = new Transform({ transform(chunk, encoding, callback) { digest.update(chunk); size += chunk.length; callback(null, chunk); } });
  await pipeline(source, meter, createWriteStream(target, { flags: 'wx' }));
  return { sha256: digest.digest('hex'), size };
}
async function hashPath(filename) {
  const digest = crypto.createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(filename)) { digest.update(chunk); size += chunk.length; }
  return { sha256: digest.digest('hex'), size };
}

export async function backup(destination) {
  const directory = path.resolve(destination);
  await mkdir(directory, { recursive: false }); await mkdir(path.join(directory, 'files'));
  let records;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      records = {};
      for (const name of collections) records[name] = await mongoose.connection.db.collection(name).find({}, { session }).toArray();
    }, { readConcern: { level: 'snapshot' } });
  } finally { await session.endSession(); }
  const files = [];
  for (const file of records.fileattachments) {
    const name = `attachment-${String(file._id)}`;
    const copied = await copyAndHash(await openFile(file), path.join(directory, 'files', name));
    if (file.sha256 && file.sha256 !== copied.sha256) throw new Error(`첨부 파일 해시가 일치하지 않습니다: ${file._id}`);
    files.push({ type: 'attachment', id: String(file._id), name, ...copied });
  }
  for (const seal of records.noteseals) {
    const name = `seal-${String(seal._id)}`;
    const copied = await copyAndHash(await openFile(seal), path.join(directory, 'files', name));
    if (seal.pdfSha256 && seal.pdfSha256 !== copied.sha256) throw new Error(`봉인 PDF 해시가 일치하지 않습니다: ${seal._id}`);
    files.push({ type: 'seal', id: String(seal._id), name, ...copied });
  }
  for (const inbox of records.inboxfiles) {
    const name = `inbox-${String(inbox._id)}`;
    const copied = await copyAndHash(await openFile(inbox), path.join(directory, 'files', name));
    if (inbox.sha256 && inbox.sha256 !== copied.sha256) throw new Error(`받은 파일 해시가 일치하지 않습니다: ${inbox._id}`);
    files.push({ type: 'inbox', id: String(inbox._id), name, ...copied });
  }
  const payload = EJSON.stringify(records);
  await writeFile(path.join(directory, 'records.json'), payload, { flag: 'wx' });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'labhub-backup', version: 4, createdAt: new Date(), recordsHash: hash(Buffer.from(payload)), files }, null, 2), { flag: 'wx' });
  return { collections: collections.length, files: files.length };
}

export async function restore(source) {
  const directory = path.resolve(source);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const payload = await readFile(path.join(directory, 'records.json'));
  if (manifest.format !== 'labhub-backup' || ![1,2,3,4].includes(manifest.version) || hash(payload) !== manifest.recordsHash)
    throw new Error('지원하지 않거나 손상된 백업입니다.');
  const records = EJSON.parse(payload.toString());
  for (const name of collections) records[name] ??= [];
  if (Object.keys(records).some((n) => !collections.includes(n)) || collections.some((n) => !Array.isArray(records[n]))) throw new Error('백업 컬렉션 형식이 잘못되었습니다.');
  const manifestFiles = new Map();
  for (const f of manifest.files || []) {
    const type = f.type || 'attachment', name = f.name || f.id, key = `${type}:${f.id}`;
    if (!['attachment','seal','inbox'].includes(type) || !/^[a-f\d]{24}$/i.test(f.id) || !/^(attachment-|seal-|inbox-)?[a-f\d]{24}$/i.test(name) || manifestFiles.has(key)) throw new Error('잘못된 첨부 ID입니다.');
    const filePath = path.join(directory, 'files', name), actual = await hashPath(filePath);
    if (actual.sha256 !== f.sha256 || actual.size !== f.size) throw new Error('첨부 파일이 손상되었습니다.');
    manifestFiles.set(key, { ...f, type, name, filePath });
  }
  if (records.fileattachments.length !== [...manifestFiles.values()].filter((f) => f.type === 'attachment').length || records.noteseals.length !== [...manifestFiles.values()].filter((f) => f.type === 'seal').length || records.inboxfiles.length !== [...manifestFiles.values()].filter((f) => f.type === 'inbox').length) throw new Error('첨부 목록이 일치하지 않습니다.');
  for (const name of collections) if (await mongoose.connection.db.collection(name).countDocuments()) throw new Error('빈 데이터베이스에만 복원할 수 있습니다.');
  const createdKeys = [];
  try {
    for (const file of records.fileattachments) {
      const item = manifestFiles.get(`attachment:${String(file._id)}`); if (!item) throw new Error('첨부 파일이 없습니다.');
      const key = await put(createReadStream(item.filePath), { key: `attachments/restore-${randomUUID()}`, contentType: file.mimeType });
      createdKeys.push(key); file.storageKey = key; delete file.path; file.filename = path.basename(key); file.sha256 = item.sha256;
    }
    for (const seal of records.noteseals) {
      const item = manifestFiles.get(`seal:${String(seal._id)}`); if (!item) throw new Error('봉인 PDF가 없습니다.');
      const key = await put(createReadStream(item.filePath), { key: `seals/restore-${randomUUID()}.pdf`, contentType: 'application/pdf' });
      createdKeys.push(key); seal.storageKey = key; delete seal.pdfPath;
    }
    for (const inbox of records.inboxfiles) {
      const item = manifestFiles.get(`inbox:${String(inbox._id)}`); if (!item) throw new Error('받은 파일이 백업에 없습니다.');
      const key = await put(createReadStream(item.filePath), { key: `inbox/restore-${randomUUID()}`, contentType: 'application/octet-stream' });
      createdKeys.push(key); inbox.storageKey = key;
    }
    for (const user of records.users) user.tokenVersion = (user.tokenVersion || 0) + 1;
    await mongoose.connection.transaction(async (session) => {
      for (const name of collections) {
        if (await mongoose.connection.db.collection(name).countDocuments({}, { session })) throw new Error('복원 대상 DB가 변경되었습니다.');
        if (records[name].length) await mongoose.connection.db.collection(name).insertMany(records[name], { session });
      }
    });
  } catch (error) { await Promise.all(createdKeys.map((key) => remove(key).catch(() => {}))); throw error; }
  return { collections: collections.length, files: createdKeys.length };
}
