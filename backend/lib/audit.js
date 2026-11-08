import AuditLog from '../models/AuditLog.js';
import AuditChainHead from '../models/AuditChainHead.js';
import { canonicalize, sha256 } from './canonical.js';

function omitUndefined(value) {
  if (Array.isArray(value)) return value.map(omitUndefined);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date) && typeof value.toJSON !== 'function') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, omitUndefined(item)]));
  }
  return value;
}

export async function appendAudit({
  userId, userName = 'System', userEmail, action, targetType, targetId, description,
  previousState, newState, ipAddress, session, apiKeyId,
}) {
  const chainKey = targetId ? `${targetType}:${targetId}` : 'system';
  await AuditChainHead.updateOne(
    { chainKey }, { $setOnInsert: { chainKey, seq: 0, hash: null } }, { upsert: true, session },
  );
  const head = await AuditChainHead.findOne({ chainKey }).session(session);
  const seq = head.seq + 1;
  const createdAt = new Date();
  const payload = Object.fromEntries(Object.entries({
    userId: userId ? String(userId) : undefined, userName, userEmail, action, targetType,
    targetId, description, previousState, newState, ipAddress, apiKeyId: apiKeyId ? String(apiKeyId) : undefined, createdAt: createdAt.toISOString(),
  }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, omitUndefined(value)]));
  const hash = sha256({ chainKey, seq, prevHash: head.hash || null, payload });
  const updated = await AuditChainHead.updateOne(
    { _id: head._id, seq: head.seq, hash: head.hash }, { $set: { seq, hash } }, { session },
  );
  if (updated.modifiedCount !== 1) throw Object.assign(new Error('감사 체인 동시 기록 충돌'), { errorLabels: ['TransientTransactionError'] });
  const record = {
    ...payload, chainKey, seq, prevHash: head.hash || null, hash,
    ...(userId ? { userId } : {}),
  };
  await AuditLog.create([record], { session });
  return record;
}

export async function audit(req, action, type, doc, before, session = null, description = '') {
  const auditState = (state) => {
    if (type !== 'ELN' || !state) return state;
    const value = state.toObject ? state.toObject() : state;
    const { content, contentDoc, ...rest } = value;
    return {
      ...rest,
      ...(content !== undefined ? { contentSha256: sha256(String(content)) } : {}),
      ...(contentDoc !== undefined ? { contentDocSha256: sha256(contentDoc) } : {}),
    };
  };
  return appendAudit({
    userId: req.user?.id, userName: req.user?.name || 'System', userEmail: req.user?.email,
    action, targetType: type, targetId: doc?._id ? String(doc._id) : undefined,
    description: description || `${type} ${action}: ${doc?.title || doc?.name || ''}`,
    previousState: auditState(before), newState: auditState(doc), ipAddress: req.ip, session,
    apiKeyId: req.apiKey?.id,
  });
}

export function merkleRoot(hashes) {
  if (!hashes.length) return sha256('');
  let level = [...hashes].sort();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(Buffer.from(`${level[i]}${level[i + 1] || level[i]}`, 'utf8')));
    level = next;
  }
  return level[0];
}

export { canonicalize };
