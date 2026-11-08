import crypto from 'node:crypto';
import mongoose from 'mongoose';
import NoteSeal from '../../models/NoteSeal.js';
import AuditAnchor from '../../models/AuditAnchor.js';
import AuditAnchorLock from '../../models/AuditAnchorLock.js';
import AuditChainHead from '../../models/AuditChainHead.js';
import { appendAudit, merkleRoot } from '../audit.js';
import { getTimestampProvider } from '../timestamp/index.js';
import { runBackground } from '../background.js';

function timestampFields(result, provider, attempts, nextAttemptAt) {
  return {
    provider,
    status: result.status || 'pending',
    tokenBase64: result.tokenBase64,
    genTime: result.genTime,
    tsaName: result.tsaName,
    serial: result.serial,
    attempts,
    lastError: result.lastError,
    requestedAt: new Date(),
    grantedAt: result.status === 'granted' ? new Date() : undefined,
    nextAttemptAt,
    lockedAt: undefined,
    lockId: undefined,
    isTrusted: Boolean(result.isTrusted),
  };
}

async function callProvider(providerName, hash) {
  try {
    const provider = getTimestampProvider(providerName);
    return await provider.request(hash);
  }
  catch (error) { return { status: error.code === 'TSA_INVALID_RESPONSE' ? 'failed' : 'pending', lastError: error.message, isTrusted: false }; }
}

async function claimSeal(sealId) {
  const now = new Date();
  return NoteSeal.findOneAndUpdate({
    _id: sealId,
    'timestamp.status': 'pending',
    $or: [
      { 'timestamp.lockId': { $exists: false } },
      { 'timestamp.lockId': null },
      { 'timestamp.lockedAt': { $lt: new Date(now.getTime() - 2 * 60 * 1000) } },
    ],
  }, { $set: { 'timestamp.lockId': crypto.randomUUID(), 'timestamp.lockedAt': now } }, { returnDocument: 'after' });
}

export async function processSealTimestamp(sealId) {
  const seal = await claimSeal(sealId);
  if (!seal) return false;
  const lockId = seal.timestamp.lockId;
  const providerName = seal.timestamp.provider || process.env.TIMESTAMP_PROVIDER || 'none';
  const result = await callProvider(providerName, seal.sealHash);
  const attempts = (seal.timestamp.attempts || 0) + 1;
  const delay = Math.min(24 * 60 * 60 * 1000, 1000 * 2 ** Math.min(attempts, 16));
  const nextAttemptAt = result.status === 'pending' ? new Date(Date.now() + delay) : undefined;
  await mongoose.connection.transaction(async (session) => {
    const current = await NoteSeal.findOne({ _id: seal._id, 'timestamp.lockId': lockId }).session(session);
    if (!current) return;
    current.timestamp = timestampFields(result, providerName, attempts, nextAttemptAt);
    await current.save({ session });
    await appendAudit({ action: 'TIMESTAMP', targetType: 'SEAL', targetId: String(current._id), description: `시점인증 상태: ${result.status}${result.lastError ? ` (${result.lastError})` : ''}`, newState: { status: result.status, provider: providerName, genTime: result.genTime, isTrusted: result.isTrusted }, session });
  });
  return true;
}

export async function processPendingTimestamps(limit = 25) {
  const now = new Date();
  const seals = await NoteSeal.find({ 'timestamp.status': 'pending', $or: [{ 'timestamp.nextAttemptAt': { $lte: now } }, { 'timestamp.nextAttemptAt': { $exists: false } }] }).sort({ 'timestamp.nextAttemptAt': 1 }).limit(limit).select('_id').lean();
  for (const seal of seals) await processSealTimestamp(seal._id);
}

async function updateAnchorTimestamp(anchor, result, attempts) {
  await mongoose.connection.transaction(async (session) => {
    const current = await AuditAnchor.findById(anchor._id).session(session);
    if (!current) return;
    current.timestamp = timestampFields(result, current.timestamp.provider, attempts, result.status === 'pending' ? new Date(Date.now() + Math.min(24 * 60 * 60 * 1000, 1000 * 2 ** Math.min(attempts, 16))) : undefined);
    await current.save({ session });
    await appendAudit({ action: 'TIMESTAMP', targetType: 'AUDIT_ANCHOR', targetId: String(current._id), description: `감사 앵커 시점인증 상태: ${result.status}`, newState: { status: result.status, provider: current.timestamp.provider, genTime: result.genTime, isTrusted: result.isTrusted }, session });
  });
}

async function retryPendingAnchor(anchor) {
  const result = await callProvider(anchor.timestamp.provider, anchor.root);
  await updateAnchorTimestamp(anchor, result, (anchor.timestamp.attempts || 0) + 1);
}

export async function createAuditAnchor({ force = false } = {}) {
  const now = new Date();
  let lock;
  try {
    lock = await AuditAnchorLock.findOneAndUpdate({ _id: 'global', $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: { $exists: false } }] }, { $set: { lockedUntil: new Date(now.getTime() + 60000) } }, { upsert: true, returnDocument: 'after' });
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
  if (!lock) return null;
  try {
    const latest = await AuditAnchor.findOne().sort({ createdAt: -1 });
    if (latest?.timestamp.status === 'pending' && latest.timestamp.nextAttemptAt <= now) await retryPendingAnchor(latest);
    const interval = Number(process.env.AUDIT_ANCHOR_INTERVAL_MS || 86400000);
    if (!force && latest && Date.now() - new Date(latest.createdAt).getTime() < interval) return latest;
    const snapshot = await mongoose.connection.transaction(async (session) => {
      const heads = await AuditChainHead.find().sort({ chainKey: 1 }).session(session).lean();
      return {
        heads,
        chainHeads: Object.fromEntries(heads.map((item) => [item.chainKey, { seq: item.seq, hash: item.hash || null }])),
        root: merkleRoot(heads.map((item) => item.hash).filter(Boolean)),
      };
    }, { readConcern: { level: 'snapshot' } });
    const { heads, chainHeads, root } = snapshot;
    const provider = getTimestampProvider();
    let result = { status: 'pending', lastError: '시점인증 요청을 기다리고 있습니다.', isTrusted: false };
    if (['none', 'enote-portal'].includes(provider.name)) result = await provider.request(root);
    let anchor;
    await mongoose.connection.transaction(async (session) => {
      [anchor] = await AuditAnchor.create([{ root, leafCount: heads.length, chainHeads, timestamp: { ...timestampFields(result, provider.name, 0, result.status === 'pending' ? new Date() : undefined) }, createdAt: new Date() }], { session });
    });
    if (result.status === 'pending') runBackground(() => retryPendingAnchor(anchor), '감사 앵커 시점인증 재시도 오류');
    return anchor;
  } finally {
    await AuditAnchorLock.updateOne({ _id: lock._id }, { $set: { lockedUntil: new Date(0), lastAnchorAt: new Date() } });
  }
}

export function startEvidenceWorkers() {
  let running = false;
  let stopped = false;
  let currentRun = Promise.resolve();
  const run = async () => {
    if (running || stopped) return;
    running = true;
    currentRun = (async () => { try {
      await processPendingTimestamps();
      await createAuditAnchor();
    } catch (error) { console.error('증빙 작업자 오류:', error.message); }
    finally { running = false; } })();
    await currentRun;
  };
  const interval = setInterval(run, 10000);
  interval.unref?.();
  void run();
  return async () => { stopped = true; clearInterval(interval); await currentRun; };
}
