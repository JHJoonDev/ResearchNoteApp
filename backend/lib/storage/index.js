import crypto from 'node:crypto';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat as statFile, unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, HeadBucketCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { dataDir } from '../../config.js';

const localRoot = path.join(dataDir, 'objects');
mkdirSync(localRoot, { recursive: true });
const provider = () => process.env.STORAGE_PROVIDER || 'local';
const validKey = (key) => {
  if (typeof key !== 'string' || !key || key.includes('\\') || key.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('Invalid storage key');
  return key;
};
let client;
function s3() {
  if (provider() !== 's3') return null;
  if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET is required for S3 storage');
  client ||= new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' } : undefined,
  });
  return client;
}
function localPath(key) {
  const resolved = path.resolve(localRoot, ...validKey(key).split('/'));
  if (!resolved.startsWith(`${path.resolve(localRoot)}${path.sep}`)) throw new Error('Invalid storage key');
  return resolved;
}

export async function put(stream, meta = {}) {
  const key = validKey(meta.key || `objects/${randomUUID()}`);
  if (provider() === 's3') {
    await new Upload({ client: s3(), params: { Bucket: process.env.S3_BUCKET, Key: key, Body: stream, ContentType: meta.contentType || 'application/octet-stream' }, leavePartsOnError: false }).done();
  } else if (provider() === 'local') {
    const target = localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    try { await pipeline(stream, createWriteStream(target, { flags: 'wx' })); }
    catch (error) { await unlink(target).catch(() => {}); throw error; }
  } else throw new Error('STORAGE_PROVIDER must be local or s3');
  return key;
}

export async function get(key) {
  validKey(key);
  if (provider() === 's3') {
    const result = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return result.Body;
  }
  return createReadStream(localPath(key));
}

export async function stat(key) {
  validKey(key);
  if (provider() === 's3') {
    const result = await s3().send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return { size: result.ContentLength, contentType: result.ContentType };
  }
  const result = await statFile(localPath(key));
  return { size: result.size };
}

export async function remove(key) {
  validKey(key);
  if (provider() === 's3') return s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  return unlink(localPath(key)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

export async function health() {
  if (provider() === 's3') {
    await s3().send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
    return true;
  }
  if (provider() !== 'local') throw new Error('STORAGE_PROVIDER must be local or s3');
  const result = await statFile(localRoot);
  if (!result.isDirectory()) throw new Error('Storage root is not a directory');
  return true;
}

export const storageProvider = provider;
export async function openFile(record) {
  if (record.storageKey) return get(record.storageKey);
  if (record.path || record.pdfPath) return createReadStream(record.path || record.pdfPath);
  throw new Error('Stored file has no storage key or legacy path');
}
export async function storageKeyForUpload(stream, key, contentType) { return put(stream, { key, contentType }); }
