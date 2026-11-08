import express from 'express';
import AuditLog from '../models/AuditLog.js';
import AuditAnchor from '../models/AuditAnchor.js';
import AuditChainHead from '../models/AuditChainHead.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { getNote, fail, text } from '../lib/core.js';
import { canonicalize, merkleRoot } from '../lib/audit.js';
import { sha256 } from '../lib/canonical.js';
import { getTimestampProvider } from '../lib/timestamp/index.js';
const router = express.Router();
router.use(auth);
function pageArgs(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) fail(400, '페이지 값을 확인해주세요.');
  return { page, limit: Math.min(200, limit) };
}
function payloadFromLog(log) {
  const fields = ['userName', 'userEmail', 'action', 'targetType', 'targetId', 'description', 'previousState', 'newState', 'ipAddress'];
  const payload = {};
  if (log.userId) payload.userId = String(log.userId);
  for (const key of fields) if (log[key] !== undefined) payload[key] = log[key];
  payload.createdAt = new Date(log.createdAt).toISOString();
  return payload;
}
router.get('/', adminOnly, async (req, res) => {
  const filter = {};
  for (const key of ['action', 'targetType', 'userId', 'targetId']) if (req.query[key]) filter[key] = text(req.query[key], key);
  const { page, limit } = pageArgs(req.query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});
router.get('/verify', adminOnly, async (req, res) => {
  const { page, limit } = pageArgs(req.query);
  const [total, heads, anchors] = await Promise.all([
    AuditChainHead.countDocuments(),
    AuditChainHead.find().sort({ chainKey: 1 }).lean(),
    AuditAnchor.find().sort({ createdAt: -1 }).lean(),
  ]);
  const allChains = [];
  const brokenAt = [];
  for (const head of heads) {
    const records = await AuditLog.find({ chainKey: head.chainKey }).sort({ seq: 1 }).lean();
    let previous = null;
    let ok = records.length === head.seq;
    for (const log of records) {
      const expected = sha256({ chainKey: head.chainKey, seq: log.seq, prevHash: previous, payload: payloadFromLog(log) });
      if (log.prevHash !== previous || log.hash !== expected) {
        ok = false;
        brokenAt.push({ chainKey: head.chainKey, seq: log.seq });
        break;
      }
      previous = log.hash;
    }
    if (head.hash !== previous) { ok = false; brokenAt.push({ chainKey: head.chainKey, seq: head.seq }); }
    allChains.push({ chainKey: head.chainKey, seq: head.seq, hash: head.hash, valid: ok });
  }
  const anchorResults = [];
  for (const anchor of anchors) {
    const root = merkleRoot(Object.values(anchor.chainHeads || {}).map((item) => typeof item === 'string' ? item : item.hash));
    let rootOk = root === anchor.root;
    for (const [chainKey, chainHead] of Object.entries(anchor.chainHeads || {})) {
      const record = await AuditLog.findOne({ chainKey, seq: chainHead.seq }).select('hash').lean();
      if (!record || record.hash !== chainHead.hash) rootOk = false;
    }
    let timestamp = anchor.timestamp;
    if (timestamp?.tokenBase64) timestamp = { ...timestamp, ...(await getTimestampProvider(timestamp.provider).verify(timestamp.tokenBase64, anchor.root)) };
    anchorResults.push({ id: String(anchor._id), root: anchor.root, leafCount: anchor.leafCount, createdAt: anchor.createdAt, valid: rootOk && ['pending', 'not_configured'].includes(timestamp.status) || rootOk && timestamp.status === 'granted', timestamp });
  }
  const chains = allChains.slice((page - 1) * limit, page * limit);
  res.json({ valid: allChains.every((item) => item.valid) && brokenAt.length === 0 && anchorResults.every((item) => item.valid), chains: { items: chains, total, page, limit }, brokenAt, anchors: { items: anchorResults.slice((page - 1) * limit, page * limit), total: anchorResults.length, page, limit } });
});
router.get('/target/:type/:id', async (req, res) => {
  if (req.params.type === 'ELN') await getNote(req);
  else if (req.user.role !== 'admin') fail(403, '관리자 권한이 필요합니다.');
  const filter = { targetType: req.params.type, targetId: req.params.id };
  const { page, limit } = pageArgs(req.query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});
export default router;
