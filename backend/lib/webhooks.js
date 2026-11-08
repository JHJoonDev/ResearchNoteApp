import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import ipaddr from 'ipaddr.js';
import Webhook from '../models/Webhook.js';
import WebhookDelivery from '../models/WebhookDelivery.js';
import { decryptSecret } from './crypto.js';

export const WEBHOOK_EVENTS = ['note.approved', 'note.rejected', 'reagent.low_stock', 'inbox.received'];

export async function enqueueWebhookEvent(event, payload, session = null) {
  if (!WEBHOOK_EVENTS.includes(event)) return 0;
  const hooks = await Webhook.find({ active: true, events: event }).select('_id').session(session);
  if (!hooks.length) return 0;
  await WebhookDelivery.create(hooks.map((hook) => ({ webhookId: hook._id, event, payload, nextAttemptAt: new Date() })), { session });
  return hooks.length;
}

export function validateWebhookUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Webhook URL을 확인해주세요.'), { status: 400 }); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = isLocalHost(host);
  const localAllowed = process.env.NODE_ENV !== 'production';
  if (url.username || url.password || (local && !localAllowed) || !['https:', ...(localAllowed ? ['http:'] : [])].includes(url.protocol) || (url.protocol === 'http:' && !local))
    throw Object.assign(new Error('Webhook은 HTTPS 주소여야 합니다.'), { status: 400 });
  return url;
}

function isLocalHost(host) { return ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase()); }

export function validateResolvedAddresses(results, local = false) {
  if (!results.length) throw new Error('DNS lookup returned no addresses');
  for (const result of results) {
    const range = ipaddr.parse(result.address).range();
    if (range !== 'unicast' && !(local && (range === 'loopback' || range === 'unspecified'))) throw new Error('Webhook host resolves to a non-public address');
  }
  return results[0];
}

async function resolveSafe(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = isLocalHost(host) && process.env.NODE_ENV !== 'production';
  const results = await dns.lookup(host, { all: true, verbatim: true });
  const selected = validateResolvedAddresses(results, local);
  return { host, address: selected.address, family: selected.family };
}

async function postPayload(url, resolved, headers, body, deadlineMs) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let deadline;
    const options = {
      protocol: url.protocol, hostname: resolved.host, port: url.port || undefined,
      path: `${url.pathname}${url.search}`, method: 'POST', agent: false,
      headers: { ...headers, host: url.host, 'content-length': Buffer.byteLength(body) },
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
      ...(url.protocol === 'https:' && !/^\d/.test(resolved.host) ? { servername: resolved.host } : {}),
    };
    const request = transport.request(options, (response) => {
      let received = 0;
      response.on('data', (chunk) => { received += chunk.length; if (received > 16 * 1024) request.destroy(new Error('Webhook response exceeded limit')); });
      response.on('end', () => { clearTimeout(deadline); resolve(response.statusCode || 0); });
    });
    request.setTimeout(Math.min(3000, deadlineMs), () => request.destroy(new Error('Webhook request timed out')));
    deadline = setTimeout(() => request.destroy(new Error('Webhook delivery deadline exceeded')), deadlineMs);
    request.on('error', (error) => { clearTimeout(deadline); reject(error); }); request.end(body);
  });
}

function deliveryDeadlineMs() {
  const value = Number(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS || 10000);
  if (!Number.isFinite(value) || value < 1 || value > 120000) throw new Error('WEBHOOK_DELIVERY_TIMEOUT_MS 설정을 확인해주세요.');
  return value;
}

export async function deliverWebhookOnce(delivery) {
  const hook = await Webhook.findOne({ _id: delivery.webhookId, active: true });
  if (!hook) return WebhookDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'failed', lastError: 'Webhook is inactive', nextAttemptAt: null } });
  try {
    const url = validateWebhookUrl(hook.url);
    const resolved = await resolveSafe(url);
    const body = JSON.stringify(delivery.payload);
    const secret = await decryptSecret(hook.secretEncrypted);
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const status = await postPayload(url, resolved, {
      'content-type': 'application/json', 'X-LabHub-Event': delivery.event,
      'X-LabHub-Delivery': String(delivery._id), 'X-LabHub-Signature': `sha256=${signature}`,
    }, body, deliveryDeadlineMs());
    if (status >= 200 && status < 300) {
      await WebhookDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'delivered', responseStatus: status, lastError: '', deliveredAt: new Date(), nextAttemptAt: null } });
    } else throw Object.assign(new Error(`Webhook returned HTTP ${status}`), { responseStatus: status });
  } catch (error) {
    const attempts = delivery.attempts || 1;
    const retry = attempts < 10;
    const delay = Math.min(6 * 60 * 60 * 1000, 1000 * 2 ** Math.min(attempts - 1, 15));
    await WebhookDelivery.updateOne({ _id: delivery._id }, { $set: {
      status: retry ? 'pending' : 'failed', responseStatus: error.responseStatus,
      lastError: String(error.message || 'Webhook delivery failed').slice(0, 1000),
      nextAttemptAt: retry ? new Date(Date.now() + delay) : null,
    } });
  }
}

let timer;
let activeDelivery = Promise.resolve();
async function pump() {
  if (activeDelivery.pending) return;
  const token = {};
  activeDelivery.pending = token;
  activeDelivery = (async () => {
    try {
      const now = new Date();
      const item = await WebhookDelivery.findOneAndUpdate(
        { status: 'pending', nextAttemptAt: { $lte: now } },
        { $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(Date.now() + 15000) } },
        { sort: { nextAttemptAt: 1, createdAt: 1 }, returnDocument: 'after' },
      );
      if (item) await deliverWebhookOnce(item);
    } catch (error) { console.error('Webhook worker failed:', error.message); }
  })();
  activeDelivery.pending = token;
  try { await activeDelivery; } finally { activeDelivery.pending = null; }
}
export function startWebhookWorker() {
  if (timer) return () => clearInterval(timer);
  timer = setInterval(() => { void pump(); }, 1000); timer.unref?.();
  return () => { clearInterval(timer); timer = undefined; };
}
export async function drainWebhookWorker() { await activeDelivery; }
