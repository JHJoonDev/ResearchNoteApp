import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Webhook from '../models/Webhook.js';
import WebhookDelivery from '../models/WebhookDelivery.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { audit, fail, objectId, text } from '../lib/core.js';
import { encryptSecret, randomToken } from '../lib/crypto.js';
import { WEBHOOK_EVENTS, validateWebhookUrl } from '../lib/webhooks.js';

const router = express.Router(); router.use(auth, adminOnly);
function events(value) {
  if (!Array.isArray(value) || !value.length || value.length > WEBHOOK_EVENTS.length || value.some((e) => !WEBHOOK_EVENTS.includes(e)) || new Set(value).size !== value.length) fail(400, 'Webhook 이벤트를 확인해주세요.');
  return value;
}
function safeView(hook) { return { id: String(hook._id), url: hook.url, events: hook.events, active: hook.active, createdAt: hook.createdAt, updatedAt: hook.updatedAt }; }
function safeAudit(hook) { return { _id: hook._id, url: hook.url, events: hook.events, active: hook.active }; }
router.get('/', async (req, res) => res.json(await Webhook.find().sort({ createdAt: -1 }).then((items) => items.map(safeView))));
router.post('/', async (req, res) => {
  let hook; const urlText = text(req.body.url, 'Webhook URL', 2048); validateWebhookUrl(urlText);
  const selectedEvents = events(req.body.events);
  if (req.body.active !== undefined && typeof req.body.active !== 'boolean') fail(400, 'Webhook 활성 상태를 확인해주세요.');
  const secret = randomToken();
  await mongoose.connection.transaction(async (session) => {
    [hook] = await Webhook.create([{ url: urlText, events: selectedEvents, active: req.body.active ?? true, secretEncrypted: await encryptSecret(secret) }], { session });
    await audit(req, 'CREATE', 'WEBHOOK', safeAudit(hook), null, session);
  });
  res.status(201).json({ ...safeView(hook), secret });
});
router.put('/:id', async (req, res) => {
  const id = objectId(req.params.id); let hook;
  await mongoose.connection.transaction(async (session) => {
    hook = await Webhook.findById(id).session(session); if (!hook) fail(404, 'Webhook을 찾을 수 없습니다.');
    const before = safeAudit(hook);
    if (req.body.url !== undefined) { hook.url = text(req.body.url, 'Webhook URL', 2048); validateWebhookUrl(hook.url); }
    if (req.body.events !== undefined) hook.events = events(req.body.events);
    if (req.body.active !== undefined) { if (typeof req.body.active !== 'boolean') fail(400, 'Webhook 활성 상태를 확인해주세요.'); hook.active = req.body.active; }
    await hook.save({ session }); await audit(req, 'UPDATE', 'WEBHOOK', safeAudit(hook), before, session);
  });
  res.json(safeView(hook));
});
router.delete('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const hook = await Webhook.findById(id).session(session); if (!hook) fail(404, 'Webhook을 찾을 수 없습니다.');
    const before = safeAudit(hook); hook.active = false; await hook.save({ session });
    await audit(req, 'DELETE', 'WEBHOOK', safeAudit(hook), before, session);
  });
  res.json({ success: true });
});
router.post('/:id/rotate-secret', async (req, res) => {
  const id = objectId(req.params.id); let hook; const secret = randomToken();
  await mongoose.connection.transaction(async (session) => {
    hook = await Webhook.findById(id).session(session); if (!hook) fail(404, 'Webhook을 찾을 수 없습니다.');
    const before = safeAudit(hook); hook.secretEncrypted = await encryptSecret(secret); await hook.save({ session });
    await audit(req, 'ROTATE_SECRET', 'WEBHOOK', safeAudit(hook), before, session);
  });
  res.json({ ...safeView(hook), secret });
});
router.get('/:id/deliveries', async (req, res) => {
  const id = objectId(req.params.id); if (!(await Webhook.exists({ _id: id }))) fail(404, 'Webhook을 찾을 수 없습니다.');
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, '페이지 값을 확인해주세요.');
  const items = await WebhookDelivery.find({ webhookId: id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  res.json({ items: items.map((item) => ({ id: String(item._id), event: item.event, status: item.status, attempts: item.attempts, responseStatus: item.responseStatus ?? null, lastError: item.lastError || '', createdAt: item.createdAt, deliveredAt: item.deliveredAt || null })), page, limit, total: await WebhookDelivery.countDocuments({ webhookId: id }) });
});
export default router;
