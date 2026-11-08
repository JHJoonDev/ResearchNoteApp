import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { connectDB } from '../database.js';
import FileAttachment from '../models/FileAttachment.js';
import NoteSeal from '../models/NoteSeal.js';
import { put, get, remove } from '../lib/storage/index.js';

const apply = process.argv.includes('--apply');
async function hashStream(stream) {
  const hash = crypto.createHash('sha256'); let size = 0;
  for await (const chunk of stream) { hash.update(chunk); size += chunk.length; }
  return { sha256: hash.digest('hex'), size };
}
const close = await connectDB();
let moved = 0, checked = 0;
try {
  const records = [
    ...(await FileAttachment.find({ storageKey: { $exists: false }, path: { $type: 'string' } }).lean()).map((doc) => ({ type: 'attachment', id: doc._id, path: doc.path, sha256: doc.sha256, mimeType: doc.mimeType })),
    ...(await NoteSeal.find({ storageKey: { $exists: false }, pdfPath: { $type: 'string' } }).lean()).map((doc) => ({ type: 'seal', id: doc._id, path: doc.pdfPath, sha256: doc.pdfSha256, mimeType: 'application/pdf' })),
  ];
  for (const record of records) {
    const source = await hashStream(createReadStream(record.path));
    if (record.sha256 && source.sha256 !== record.sha256) throw new Error(`Hash mismatch for ${record.type} ${record.id}`);
    checked++;
    if (!apply) continue;
    const key = await put(createReadStream(record.path), { key: `${record.type === 'seal' ? 'seals' : 'attachments'}/migrated-${record.id}-${crypto.randomUUID()}`, contentType: record.mimeType });
    try {
      const copied = await hashStream(await get(key));
      if (copied.sha256 !== source.sha256 || copied.size !== source.size) throw new Error(`Storage verification failed for ${record.type} ${record.id}`);
      await mongoose.connection.transaction(async (session) => {
        if (record.type === 'attachment') {
          const current = await FileAttachment.findOne({ _id: record.id, storageKey: { $exists: false }, sha256: record.sha256 }).session(session);
          if (!current) throw new Error(`Attachment changed during migration: ${record.id}`);
          current.storageKey = key; await current.save({ session });
        } else {
          const current = await NoteSeal.findOne({ _id: record.id, storageKey: { $exists: false }, pdfSha256: record.sha256 }).session(session);
          if (!current) throw new Error(`Seal changed during migration: ${record.id}`);
          current.storageKey = key; await current.save({ session });
        }
      });
      moved++;
    } catch (error) { await remove(key).catch(() => {}); throw error; }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', checked, moved, sourceFilesDeleted: 0 }));
} finally { await close(); }
