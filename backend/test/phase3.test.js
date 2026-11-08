import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir, truncate } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'labhub-phase3-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'phase3-test-secret-with-at-least-32-characters';
process.env.SEARCH_PROVIDER = 'memory';
process.env.STORAGE_PROVIDER = 'local';
process.env.MAX_UPLOAD_MB = '200';
process.env.API_KEY_RATE_LIMIT = '120';
process.env.INBOX_UPLOAD_TIMEOUT_MS = '120000';
process.env.METRICS_TOKEN = 'phase3-metrics-secret';
process.env.ALLOW_LEGACY_ELN_WRITES = 'true';
for (const key of ['OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET','OIDC_REDIRECT_URI','OIDC_LABEL']) delete process.env[key];

const requestLogs = [];
const savedConsoleLog = console.log;
console.log = (...args) => { if (typeof args[0] === 'string') { try { requestLogs.push(JSON.parse(args[0])); } catch {} } };
const { app } = await import('../app.js');
const { jwtSecret } = await import('../config.js');
const User = (await import('../models/User.js')).default;
const Project = (await import('../models/Project.js')).default;
const Note = (await import('../models/ElnNote.js')).default;
const Item = (await import('../models/LimsItem.js')).default;
const Lot = (await import('../models/LimsLot.js')).default;
const EntityType = (await import('../models/EntityType.js')).default;
const Entity = (await import('../models/Entity.js')).default;
const Location = (await import('../models/Location.js')).default;
const Booking = (await import('../models/Booking.js')).default;
const ApiKey = (await import('../models/ApiKey.js')).default;
const InboxFile = (await import('../models/InboxFile.js')).default;
const Webhook = (await import('../models/Webhook.js')).default;
const WebhookDelivery = (await import('../models/WebhookDelivery.js')).default;
const AuditLog = (await import('../models/AuditLog.js')).default;
const FileAttachment = (await import('../models/FileAttachment.js')).default;
const NoteSeal = (await import('../models/NoteSeal.js')).default;
const OidcLoginState = (await import('../models/OidcLoginState.js')).default;
const { openFile, put, get, stat, remove, health: storageHealth } = await import('../lib/storage/index.js');
const { backup } = await import('../lib/backup.js');
const { actualV1RouteCoverage, OPENAPI } = await import('../routes/api-v1.js');
const { validateWebhookUrl, validateResolvedAddresses, deliverWebhookOnce } = await import('../lib/webhooks.js');
const { createManifest } = await import('../lib/seal/manifest.js');
const { createSealPdf } = await import('../lib/seal/pdf.js');
const { uploadFileStream } = await import('../../tools/instrument-agent/src/uploader.js');

const repl = await MongoMemoryReplSet.create({
  binary: { downloadDir: path.join(root, 'node_modules/.cache/mongodb-memory-server') },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
await mongoose.connect(repl.getUri(), { dbName: 'phase3' });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const api = `http://127.0.0.1:${server.address().port}/api`;
const password = 'Phase3-regression-password-2026';
const sessionToken = (user) => jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion || 0, scope: 'session' }, jwtSecret, { algorithm: 'HS256', expiresIn: '12h' });
const cookie = (user) => `labhub_session=${sessionToken(user)}`;
async function createUser(name, role = 'researcher') {
  return User.create({ name, email: `${name}@phase3.test`, password: await bcrypt.hash(password, 4), role });
}
async function call(method, pathname, body, user = null, headers = {}) {
  const response = await fetch(api + pathname, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(user ? { Cookie: cookie(user) } : {}),
      ...(!['GET','HEAD','OPTIONS'].includes(method) ? { 'X-LabHub-Request': '1' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data, headers: response.headers };
}
async function createApiKey(user, scopes = ['notes:read']) {
  const result = await call('POST', '/api-keys', { name: 'Phase 3 test key', scopes }, user);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}
async function apiKeyCall(method, pathname, key, body = undefined, extraHeaders = {}) {
  return call(method, `/v1${pathname}`, body, null, { Authorization: `Bearer ${key}`, ...extraHeaders });
}
async function readStored(record) {
  const chunks = []; for await (const chunk of await openFile(record)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function hashFile(filename) {
  const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest('hex');
}
async function createNote(user, payload = {}) {
  return call('POST', '/eln', { title: 'Phase 3 노트', content: '<p>관찰 결과</p>', ...payload }, user);
}
function normalizeOpenApiRoute(value) { return value.replace(/:([A-Za-z0-9_]+)/g, '{$1}'); }

await test('Phase 3 backend contract and regression coverage', async (t) => {
  const admin = await createUser('admin3', 'admin');
  const researcher = await createUser('researcher3');
  const viewer = await createUser('projectviewer3');
  const outsider = await createUser('outsider3');
  const project = await Project.create({ name: 'Phase 3 project', members: [
    { userId: researcher._id, name: researcher.name, role: 'editor' },
    { userId: viewer._id, name: viewer.name, role: 'viewer' },
  ] });
  const projectNote = await Note.create({ title: 'viewer can read', authorId: researcher._id, author: researcher.name, projectId: project._id, content: '<p>project content</p>' });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect(); await repl.stop();
    console.log = savedConsoleLog;
    if (path.dirname(dataDir) === path.resolve(os.tmpdir()) && path.basename(dataDir).startsWith('labhub-phase3-')) await rm(dataDir, { recursive: true, force: true });
  });

  await t.test('Liveness, readiness, metrics, and structured request logs', async () => {
    assert.equal((await call('GET', '/health')).status, 200);
    const ready = await call('GET', '/health/ready');
    assert.equal(ready.status, 200); assert.deepEqual(ready.data, { status: 'ok', database: true, storage: true });
    assert.equal(await storageHealth(), true);
    await assert.rejects(() => readdir(path.join(dataDir, 'objects', 'health')), { code: 'ENOENT' });
    assert.equal((await call('GET', '/metrics')).status, 401);
    const metrics = await call('GET', '/metrics', undefined, null, { 'X-Metrics-Token': process.env.METRICS_TOKEN });
    assert.equal(metrics.status, 200); assert.match(await metrics.headers.get('content-type'), /text\/plain/);
    const log = requestLogs.find((row) => row.event === 'http_request' && row.path === '/api/health');
    assert.ok(log); assert.equal('headers' in log, false); assert.equal('body' in log, false); assert.equal('query' in log, false);
  });

  await t.test('Initial lot, FIFO allocations, usage edits, direct stock guard, and race conservation', async () => {
    let created = await call('POST', '/lims', { name: 'FIFO 시약', stockValue: 0, unit: 'mL' }, admin);
    assert.equal(created.status, 201);
    const reagentId = created.data.id;
    const initial = (await call('GET', `/lims/${reagentId}/lots`, undefined, researcher)).data;
    assert.equal(initial.length, 1); assert.match(initial[0].lotNumber, /^INITIAL-\d{8}$/);
    let lotA = await call('POST', `/lims/${reagentId}/lots`, { lotNumber: 'LOT-EARLY', amount: 5, expirationDate: '2027-01-01', supplierLot: 'SUP-A' }, admin);
    let lotB = await call('POST', `/lims/${reagentId}/lots`, { lotNumber: 'LOT-LATE', amount: 6, expirationDate: '2028-01-01' }, admin);
    assert.equal(lotA.status, 201); assert.equal(lotB.status, 201);
    const direct = await call('PUT', `/lims/${reagentId}`, { version: (await Item.findById(reagentId)).__v, stockValue: 99 }, admin);
    assert.equal(direct.status, 409);
    let note = await createNote(researcher, { reagentsUsed: [{ reagentId, amount: 8, unit: 'mL' }] });
    assert.equal(note.status, 201, JSON.stringify(note.data));
    let usage = note.data.reagentsUsed[0];
    assert.deepEqual(usage.allocations.map((a) => [a.lotNumber, a.amount]), [['LOT-EARLY', 5], ['LOT-LATE', 3]]);
    assert.equal((await Item.findById(reagentId)).stockValue, 3);
    const version = note.data.version;
    note = await call('PUT', `/eln/${note.data.id}`, { title: note.data.title, content: note.data.content, contentFormat: 'html', version, changeReason: '사용량 수정', reagentsUsed: [{ reagentId, amount: 6, unit: 'mL' }] }, researcher);
    assert.equal(note.status, 200, JSON.stringify(note.data));
    usage = note.data.reagentsUsed[0];
    assert.deepEqual(usage.allocations.map((a) => [a.lotNumber, a.amount]), [['LOT-EARLY', 5], ['LOT-LATE', 1]]);
    assert.equal((await Item.findById(reagentId)).stockValue, 5);
    const lots = await Lot.find({ reagentId, isDeleted: false });
    assert.equal((await Item.findById(reagentId)).stockValue, lots.reduce((sum, lot) => sum + lot.remainingAmount, 0));
    const savedNote = await Note.findById(note.data.id);
    const sealedShape = await createManifest(savedNote, []);
    assert.deepEqual(sealedShape.manifest.reagentsUsed[0].allocations.map((a) => a.lotNumber), ['LOT-EARLY', 'LOT-LATE']);

    const race = await call('POST', '/lims', { name: '동시 소모 시약', stockValue: 6, unit: 'mL' }, admin);
    const attempts = await Promise.all([
      createNote(researcher, { reagentsUsed: [{ reagentId: race.data.id, amount: 4, unit: 'mL' }] }),
      createNote(outsider, { reagentsUsed: [{ reagentId: race.data.id, amount: 4, unit: 'mL' }] }),
    ]);
    assert.equal(attempts.filter((item) => item.status === 201).length, 1);
    assert.equal(attempts.filter((item) => item.status === 409).length, 1);
    const raceLots = await Lot.find({ reagentId: race.data.id, isDeleted: false });
    assert.equal((await Item.findById(race.data.id)).stockValue, raceLots.reduce((sum, lot) => sum + lot.remainingAmount, 0));
  });

  await t.test('Lot status is derived; grid coordinates are 1-based', async () => {
    const item = await call('POST', '/lims', { name: '상태 시약', stockValue: 2, unit: 'g' }, admin);
    let lot = (await call('GET', `/lims/${item.data.id}/lots`, undefined, admin)).data[0];
    assert.equal(lot.status, '사용가능');
    const invalid = await call('PUT', `/lims/lots/${lot.id}`, { version: lot.version, status: '소진' }, admin);
    assert.equal(invalid.status, 400);
    const adjusted = await call('POST', `/lims/lots/${lot.id}/adjust`, { version: lot.version, delta: -2, reason: '완전 소모' }, admin);
    assert.equal(adjusted.status, 200);
    lot = (await call('GET', `/lims/${item.data.id}/lots`, undefined, admin)).data[0];
    assert.equal(lot.status, '소진');
    const location = await call('POST', '/locations', { name: '냉동고', kind: 'freezer', grid: { rows: 2, cols: 3 } }, admin);
    const badSlot = await call('POST', '/locations', { name: '잘못된 격자', kind: 'box', grid: { rows: 0, cols: 2 } }, admin);
    assert.equal(location.status, 201); assert.equal(badSlot.status, 400);
  });

  await t.test('Lot and stock quantities round to six decimals and labels stay clean', async () => {
    const created = await call('POST', '/lims', { name: 'Precision reagent', stockValue: 3.1800000002, unit: 'L' }, admin);
    assert.equal(created.status, 201);
    const reagentId = created.data.id;
    let lots = (await call('GET', `/lims/${reagentId}/lots`, undefined, admin)).data;
    const initial = lots.find((lot) => lot.lotNumber.startsWith('INITIAL-'));
    assert.ok(initial);
    assert.equal(initial.initialAmount, 3.18);
    assert.equal(initial.remainingAmount, 3.18);

    const received = await call('POST', `/lims/${reagentId}/lots`, { lotNumber: 'LOT-DECIMAL', amount: 0.0700000002 }, admin);
    assert.equal(received.status, 201, JSON.stringify(received.data));
    assert.equal(received.data.initialAmount, 0.07);
    assert.equal(received.data.remainingAmount, 0.07);

    for (let index = 0; index < 10; index++) {
      lots = (await call('GET', `/lims/${reagentId}/lots`, undefined, admin)).data;
      const current = lots.find((lot) => lot.id === initial.id);
      const adjusted = await call('POST', `/lims/lots/${initial.id}/adjust`, { version: current.version, delta: -0.1, reason: '소수점 정밀도 회귀' }, admin);
      assert.equal(adjusted.status, 200, JSON.stringify(adjusted.data));
    }

    const storedLots = await Lot.find({ reagentId, isDeleted: false });
    const storedItem = await Item.findById(reagentId);
    assert.equal(storedLots.find((lot) => String(lot._id) === initial.id).remainingAmount, 2.18);
    assert.equal(storedLots.find((lot) => lot.lotNumber === 'LOT-DECIMAL').remainingAmount, 0.07);
    assert.equal(storedItem.stockValue, 2.25);
    assert.equal(storedItem.stockValue, storedLots.reduce((sum, lot) => sum + lot.remainingAmount, 0));

    const labelResponse = await fetch(api + '/labels/zpl', {
      method: 'POST',
      headers: { Cookie: cookie(admin), 'X-LabHub-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ type: 'lot', id: initial.id }], template: '50x25' }),
    });
    assert.equal(labelResponse.status, 200);
    assert.match(await labelResponse.text(), /2\.18 L/);
  });

  await t.test('Migration dry-run, apply, and idempotency', async () => {
    const oldItem = await Item.create({ name: 'legacy reagent', stockValue: 7, unit: 'mg' });
    const historical = await Note.create({ title: 'legacy note', authorId: researcher._id, author: researcher.name, reagentsUsed: [{ reagentId: oldItem._id, name: oldItem.name, amount: 2, unit: 'mg' }] });
    const beforeCount = await Lot.countDocuments({ reagentId: oldItem._id });
    const env = { ...process.env, MONGO_URI: repl.getUri(), DB_NAME: 'phase3', NODE_ENV: 'test', DATA_DIR: dataDir };
    const dry = await execFile(process.execPath, ['scripts/migrate-lims-lots.js'], { cwd: root, env });
    assert.match(dry.stdout, /"mode":"dry-run"/);
    assert.equal(await Lot.countDocuments({ reagentId: oldItem._id }), beforeCount);
    await execFile(process.execPath, ['scripts/migrate-lims-lots.js', '--apply'], { cwd: root, env });
    await execFile(process.execPath, ['scripts/migrate-lims-lots.js', '--apply'], { cwd: root, env });
    const migrated = await Lot.findOne({ reagentId: oldItem._id, lotNumber: `LEGACY-${oldItem._id}` });
    assert.ok(migrated); assert.equal(migrated.remainingAmount, 7);
    const updated = await Note.findById(historical._id);
    assert.equal(String(updated.reagentsUsed[0].allocations[0].lotId), String(migrated._id));
    assert.equal(await Lot.countDocuments({ reagentId: oldItem._id, lotNumber: `LEGACY-${oldItem._id}` }), 1);
  });

  await t.test('Location cycles, type-field 409s, grid uniqueness, and viewer role permissions', async () => {
    const rootLocation = await call('POST', '/locations', { name: '실험실', kind: 'room' }, admin);
    const grid = await call('POST', '/locations', { name: '시료함', kind: 'box', parentId: rootLocation.data._id, grid: { rows: 2, cols: 2 } }, admin);
    assert.equal(rootLocation.status, 201); assert.equal(grid.status, 201);
    const cycle = await call('PUT', `/locations/${rootLocation.data._id}`, { parentId: grid.data._id }, admin);
    assert.equal(cycle.status, 409);
    const createdType = await call('POST', '/entity-types', { name: 'Phase 3 sample', kind: 'sample', fields: [{ name: 'Species', kind: 'text', required: true }] }, admin);
    assert.equal(createdType.status, 201);
    const fieldId = createdType.data.fields[0].id;
    const projectEntity = await call('POST', '/entities', { typeId: String(createdType.data._id), code: 'S-001', name: 'Sample 1', values: { [fieldId]: 'water' }, projectId: String(project._id), locationId: String(grid.data._id), position: { row: 1, col: 1 } }, researcher);
    assert.equal(projectEntity.status, 201, JSON.stringify(projectEntity.data));
    const targetProject = await Project.create({ name: 'Entity move target', members: [{ userId: outsider._id, name: outsider.name, role: 'editor' }] });
    assert.equal((await call('PUT', `/entities/${projectEntity.data._id}`, { projectId: String(targetProject._id) }, outsider)).status, 403);
    assert.equal((await call('PUT', `/entities/${projectEntity.data._id}`, { projectId: null }, outsider)).status, 403);
    assert.equal((await call('PUT', `/entities/${projectEntity.data._id}`, { projectId: String(targetProject._id) }, researcher)).status, 403);
    assert.equal(String((await Entity.findById(projectEntity.data._id)).projectId), String(project._id));

    const smallGrid = await call('POST', '/locations', { name: 'One-cell box', kind: 'box', grid: { rows: 1, cols: 1 } }, admin);
    const plainLocation = await call('POST', '/locations', { name: 'Ungridded shelf', kind: 'shelf' }, admin);
    assert.equal(smallGrid.status, 201);
    assert.equal(plainLocation.status, 201);
    const gridEntity = await call('POST', '/entities', { typeId: String(createdType.data._id), code: 'S-GRID', name: 'Grid sample', values: { [fieldId]: 'ice' }, locationId: String(grid.data._id), position: { row: 2, col: 2 } }, admin);
    assert.equal(gridEntity.status, 201);
    assert.deepEqual((await Entity.findById(gridEntity.data._id).lean()).position, { row: 2, col: 2 });
    assert.equal((await call('PUT', `/entities/${gridEntity.data._id}`, { position: { row: 3, col: 1 } }, admin)).status, 400);
    assert.equal((await call('PUT', `/entities/${gridEntity.data._id}`, { locationId: String(smallGrid.data._id) }, admin)).status, 400);
    const moveToUngrid = await call('PUT', `/entities/${gridEntity.data._id}`, { locationId: String(plainLocation.data._id) }, admin);
    assert.equal(moveToUngrid.status, 400, JSON.stringify({ entity: await Entity.findById(gridEntity.data._id).lean(), location: await Location.findById(plainLocation.data._id).lean(), response: moveToUngrid.data }));

    const alternateType = await call('POST', '/entity-types', { name: 'Alternate sample', kind: 'sample', fields: [{ id: 'concentration', name: 'Concentration', kind: 'number', required: true }] }, admin);
    assert.equal(alternateType.status, 201);
    assert.equal((await call('PUT', `/entities/${projectEntity.data._id}`, { typeId: String(alternateType.data._id) }, researcher)).status, 400);
    assert.equal((await call('POST', '/entity-types', { name: 'Invalid field id type', kind: 'sample', fields: [{ id: 'field.path', name: 'Unsafe field', kind: 'text' }] }, admin)).status, 400);
    const noteWithEntity = await createNote(researcher, { projectId: String(project._id), entitiesUsed: [{ entityId: String(projectEntity.data._id) }] });
    assert.equal(noteWithEntity.status, 201);
    assert.deepEqual(noteWithEntity.data.entitiesUsed[0], { entityId: String(projectEntity.data._id), code: 'S-001', name: 'Sample 1', typeName: 'Phase 3 sample' });
    const entityManifest = await createManifest(await Note.findById(noteWithEntity.data.id), []);
    assert.deepEqual(entityManifest.manifest.entitiesUsed[0], { entityId: String(projectEntity.data._id), code: 'S-001', name: 'Sample 1', typeName: 'Phase 3 sample' });
    const pdfPath = await createSealPdf({ noteId: noteWithEntity.data.id, version: 1, manifest: entityManifest.manifest, manifestSha256: entityManifest.manifestSha256, signatures: [], verifyUrl: 'https://labhub.example.test/verify/test', attachmentFiles: [] });
    assert.ok((await readFile(pdfPath)).length > 1000);
    const invalidSnapshot = await createNote(researcher, { projectId: String(project._id), entitiesUsed: [{ entityId: String(projectEntity.data._id), name: 'forged' }] });
    assert.equal(invalidSnapshot.status, 400);
    const fieldChange = await call('PUT', `/entity-types/${createdType.data._id}`, { name: 'Phase 3 sample', kind: 'sample', fields: [] }, admin);
    assert.equal(fieldChange.status, 409);
    const duplicateSlot = await call('POST', '/entities', { typeId: String(createdType.data._id), code: 'S-002', name: 'Sample 2', values: { [fieldId]: 'salt' }, projectId: String(project._id), locationId: String(grid.data._id), position: { row: 1, col: 1 } }, researcher);
    assert.equal(duplicateSlot.status, 409);
    const viewerRead = await call('GET', `/entities/${projectEntity.data._id}`, undefined, viewer);
    const viewerWrite = await call('PUT', `/entities/${projectEntity.data._id}`, { name: 'forbidden' }, viewer);
    const viewerDelete = await call('DELETE', `/entities/${projectEntity.data._id}`, {}, viewer);
    const viewerCreate = await call('POST', '/entities', { typeId: String(createdType.data._id), code: 'S-003', name: 'Viewer sample', values: { [fieldId]: 'ice' }, projectId: String(project._id) }, viewer);
    assert.equal(viewerRead.status, 200); assert.equal(viewerWrite.status, 403); assert.equal(viewerDelete.status, 403); assert.equal(viewerCreate.status, 403);
    assert.equal((await call('GET', '/entities/not-an-object-id', undefined, admin)).status, 400);
    const used = await call('DELETE', `/locations/${grid.data._id}`, {}, admin);
    assert.equal(used.status, 409);
  });

  await t.test('Concurrent equipment bookings, access-checked labels, and scan resolution', async () => {
    const equipmentType = await call('POST', '/entity-types', { name: 'Phase 3 equipment', kind: 'equipment', fields: [] }, admin);
    const equipment = await call('POST', '/entities', { typeId: String(equipmentType.data._id), code: 'EQ-001', name: 'Centrifuge', values: {}, projectId: String(project._id), calibrationDueAt: new Date(Date.now() + 5 * 86400000).toISOString() }, researcher);
    assert.equal(equipment.status, 201);
    const interval = { start: '2027-01-01T10:00:00.000Z', end: '2027-01-01T11:00:00.000Z', purpose: 'centrifuge run' };
    const races = await Promise.all([call('POST', `/entities/${equipment.data._id}/bookings`, interval, researcher), call('POST', `/entities/${equipment.data._id}/bookings`, interval, researcher)]);
    assert.equal(races.filter((r) => r.status === 201).length, 1);
    assert.equal(races.filter((r) => r.status === 409).length, 1);
    assert.equal((await Booking.countDocuments({ entityId: equipment.data._id, status: 'booked' })), 1);
    const alerts = await call('GET', '/equipment/alerts', undefined, researcher);
    assert.equal(alerts.status, 200); assert.ok(alerts.data.some((entity) => String(entity._id) === String(equipment.data._id)));
    const adminScan = await call('GET', `/scan/resolve?code=LH1:equipment:${equipment.data._id}`, undefined, admin);
    const forbiddenScan = await call('GET', `/scan/resolve?code=LH1:equipment:${equipment.data._id}`, undefined, outsider);
    assert.equal(adminScan.status, 200); assert.equal(adminScan.data.title, 'Centrifuge'); assert.equal(forbiddenScan.status, 404);
    const zplResponse = await fetch(api + '/labels/zpl', { method: 'POST', headers: { Cookie: cookie(admin), 'X-LabHub-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ type: 'equipment', id: String(equipment.data._id) }], template: '50x25' }) });
    assert.equal(zplResponse.status, 200); assert.match(await zplResponse.text(), /LH1:equipment:/);
    const pdfResponse = await fetch(api + '/labels/pdf', { method: 'POST', headers: { Cookie: cookie(admin), 'X-LabHub-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ type: 'equipment', id: String(equipment.data._id) }], sheet: '38x19', startOffset: 1 }) });
    assert.equal(pdfResponse.status, 200); assert.match(Buffer.from(await pdfResponse.arrayBuffer()).toString('latin1', 0, 5), /%PDF-/);
    assert.equal((await call('POST', '/labels/pdf', { items: [{ type: 'equipment', id: String(equipment.data._id) }], sheet: { width: 90, height: 30, columns: 1 } }, admin)).status, 400);
    assert.equal((await call('POST', '/labels/zpl', { items: [{ type: 'equipment', id: String(equipment.data._id), title: 'spoofed' }], template: '50x25' }, admin)).status, 400);
  });

  await t.test('Korean multipart names survive attachment storage, download, and v1 inbox attachment', async () => {
    const filename = '측정결과.txt';
    const note = await createNote(researcher);
    assert.equal(note.status, 201);
    const bytes = Buffer.from('Korean filename payload', 'utf8');
    const form = new FormData();
    form.append('noteId', note.data.id);
    form.append('version', String(note.data.version));
    form.append('file', new Blob([bytes], { type: 'text/plain' }), filename);
    const uploaded = await call('POST', '/files/upload', form, researcher);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    const attachmentId = String(uploaded.data.file._id);
    const storedAttachment = await FileAttachment.findById(attachmentId);
    assert.equal(storedAttachment.originalName, filename);
    const download = await fetch(`${api}/files/${attachmentId}/download`, { headers: { Cookie: cookie(researcher) } });
    assert.equal(download.status, 200);
    const disposition = download.headers.get('content-disposition') || '';
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    assert.ok(encodedName, disposition);
    assert.equal(decodeURIComponent(encodedName), filename);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

    const apiKey = await createApiKey(researcher, ['inbox:write']);
    const instrumentId = 'Korean filename instrument';
    const relativePath = `2026/run 2/${filename}`;
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const capturedAt = new Date().toISOString();
    const inboxForm = new FormData();
    inboxForm.append('instrumentId', instrumentId);
    inboxForm.append('relativePath', relativePath);
    inboxForm.append('sha256', sha256);
    inboxForm.append('capturedAt', capturedAt);
    inboxForm.append('file', new Blob([bytes], { type: 'text/plain' }), filename);
    const idempotencyKey = crypto.createHash('sha256').update(instrumentId + relativePath + sha256).digest('hex');
    const inboxResult = await call('POST', '/v1/inbox/files', inboxForm, null, { Authorization: `Bearer ${apiKey.key}`, 'Idempotency-Key': idempotencyKey });
    assert.equal(inboxResult.status, 201, JSON.stringify(inboxResult.data));
    const inbox = await InboxFile.findById(inboxResult.data.id);
    assert.equal(inbox.relativePath, relativePath);
    const attached = await call('POST', `/inbox/${inbox._id}/attach`, { noteId: note.data.id, version: uploaded.data.version }, researcher);
    assert.equal(attached.status, 201, JSON.stringify(attached.data));
    assert.equal((await FileAttachment.findById(attached.data.file.id)).originalName, filename);
  });

  await t.test('API key scopes, current owner state, cookies, bearer isolation, and OpenAPI coverage', async () => {
    const readKey = await createApiKey(viewer, ['notes:read']);
    assert.match(readKey.key, /^lh_[a-f\d]{12}_[A-Za-z0-9_-]{40,}$/);
    const storedKey = await ApiKey.findById(readKey.id);
    assert.notEqual(storedKey.hash, readKey.key);
    const listed = await call('GET', '/api-keys', undefined, viewer);
    assert.equal('key' in listed.data[0], false);
    const projectNotes = await apiKeyCall('GET', '/notes', readKey.key);
    assert.equal(projectNotes.status, 200); assert.ok(projectNotes.data.items.some((note) => String(note._id) === String(projectNote._id)));
    assert.equal((await apiKeyCall('GET', `/notes/${projectNote._id}`, readKey.key)).status, 200);
    assert.equal((await apiKeyCall('GET', '/reagents', readKey.key)).status, 403);
    assert.equal((await call('GET', '/v1/notes', undefined, viewer)).status, 401);
    assert.equal((await apiKeyCall('GET', '/notes', readKey.key, undefined, { Cookie: cookie(viewer) })).status, 401);
    assert.equal((await call('GET', '/auth/me', undefined, null, { Authorization: `Bearer ${readKey.key}` })).status, 401);
    const openapi = await apiKeyCall('GET', '/openapi.json', readKey.key);
    assert.equal(openapi.status, 200); assert.equal(openapi.data.openapi, '3.1.0');
    const documented = Object.entries(OPENAPI.paths).flatMap(([route, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${route}`)).sort();
    assert.deepEqual(actualV1RouteCoverage().map(normalizeOpenApiRoute), documented);
    viewer.isActive = false; await viewer.save();
    assert.equal((await apiKeyCall('GET', '/notes', readKey.key)).status, 401);
    viewer.isActive = true; await viewer.save();
    assert.equal((await call('DELETE', `/api-keys/${readKey.id}`, {}, viewer)).status, 200);
    assert.equal((await apiKeyCall('GET', '/notes', readKey.key)).status, 401);
    const providers = await call('GET', '/auth/providers');
    assert.deepEqual(providers.data, { oidc: { enabled: false, label: '기관 계정' } });
  });

  await t.test('Instrument-agent upload, idempotency, audit key, response table, temp cleanup, and streaming memory', async () => {
    const owner = await createUser('instrumentowner3');
    const fullKey = await createApiKey(owner, ['inbox:write']);
    const noScope = await createApiKey(owner, ['notes:read']);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'labhub-agent-e2e-'));
    const smallPath = path.join(tempDir, 'result.raw');
    const small = Buffer.from('instrument result bytes'); await writeFile(smallPath, small);
    const mtimeMs = (await import('node:fs/promises')).stat(smallPath).then((s) => s.mtimeMs);
    const tempBefore = (await readdir(os.tmpdir())).filter((name) => name.startsWith('labhub-inbox-')).sort();
    const payload = { serverUrl: `http://127.0.0.1:${server.address().port}`, apiKey: fullKey.key, instrumentId: 'LC-MS 01', relativePath: '2026/run 1/결과.raw', absolutePath: smallPath, fileSize: small.length, mtimeMs: await mtimeMs, sha256: crypto.createHash('sha256').update(small).digest('hex') };
    const accepted = await uploadFileStream(payload);
    assert.equal(accepted.statusCode, 201, JSON.stringify(accepted.body));
    const duplicate = await uploadFileStream(payload);
    assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.body.duplicate, true);
    const inbox = await InboxFile.findById(accepted.body.id);
    assert.equal(inbox.instrumentId, payload.instrumentId); assert.equal(inbox.relativePath, payload.relativePath);
    assert.equal(await hashFile(smallPath), inbox.sha256); assert.equal((await readStored(inbox)).toString(), small.toString());
    const audit = await AuditLog.findOne({ targetType: 'INBOX_FILE', targetId: String(inbox._id) });
    assert.equal(String(audit.apiKeyId), fullKey.id);
    assert.deepEqual((await readdir(os.tmpdir())).filter((name) => name.startsWith('labhub-inbox-')).sort(), tempBefore);

    assert.equal((await uploadFileStream({ ...payload, apiKey: 'lh_000000000000_invalid-key' })).statusCode, 401);
    assert.equal((await uploadFileStream({ ...payload, apiKey: noScope.key })).statusCode, 403);
    assert.equal((await uploadFileStream({ ...payload, relativePath: '../escape.raw' })).statusCode, 400);
    const malformed = new FormData(); malformed.append('instrumentId', payload.instrumentId); malformed.append('relativePath', payload.relativePath); malformed.append('sha256', payload.sha256); malformed.append('capturedAt', new Date(payload.mtimeMs).toISOString()); malformed.append('file', new Blob([small], { type: 'application/octet-stream' }), 'result.raw');
    const badIdempotency = await call('POST', '/v1/inbox/files', malformed, null, { Authorization: `Bearer ${fullKey.key}`, 'Idempotency-Key': 'bad' });
    assert.equal(badIdempotency.status, 400);
    const unsupported = new FormData(); unsupported.append('file', new Blob(['x'], { type: 'application/x-unsupported' }), 'bad.bin');
    assert.equal((await call('POST', '/v1/inbox/files', unsupported, null, { Authorization: `Bearer ${fullKey.key}` })).status, 415);
    assert.equal((await call('POST', '/v1/inbox/files', undefined, null, { Authorization: `Bearer ${fullKey.key}`, 'Content-Type': 'application/json' })).status, 415);
    const badHash = await uploadFileStream({ ...payload, relativePath: 'retry/bad-hash.raw', sha256: '0'.repeat(64) });
    assert.equal(badHash.statusCode, 422);

    const largePath = path.join(tempDir, 'sparse-large.raw'); await writeFile(largePath, Buffer.alloc(0)); await truncate(largePath, 24 * 1024 * 1024);
    const largeStat = await (await import('node:fs/promises')).stat(largePath), largeHash = await hashFile(largePath);
    const rssBefore = process.memoryUsage().rss;
    const largeResponse = await uploadFileStream({ ...payload, relativePath: 'large/sparse.raw', absolutePath: largePath, fileSize: largeStat.size, mtimeMs: largeStat.mtimeMs, sha256: largeHash });
    const rssAfter = process.memoryUsage().rss;
    assert.equal(largeResponse.statusCode, 201); assert.ok(rssAfter - rssBefore < 64 * 1024 * 1024, `RSS increased by ${rssAfter - rssBefore} bytes`);

    process.env.MAX_UPLOAD_MB = '1';
    const tooLargePath = path.join(tempDir, 'too-large.raw'); await writeFile(tooLargePath, Buffer.alloc(0)); await truncate(tooLargePath, 2 * 1024 * 1024);
    const tooLargeStat = await (await import('node:fs/promises')).stat(tooLargePath);
    const tooLarge = await uploadFileStream({ ...payload, relativePath: 'large/rejected.raw', absolutePath: tooLargePath, fileSize: tooLargeStat.size, mtimeMs: tooLargeStat.mtimeMs, sha256: await hashFile(tooLargePath) });
    assert.equal(tooLarge.statusCode, 413); process.env.MAX_UPLOAD_MB = '200';

    process.env.API_KEY_RATE_LIMIT = '1';
    const rateKey = await createApiKey(owner, ['notes:read']);
    assert.equal((await apiKeyCall('GET', '/openapi.json', rateKey.key)).status, 200);
    assert.equal((await apiKeyCall('GET', '/openapi.json', rateKey.key)).status, 429);
    process.env.API_KEY_RATE_LIMIT = '1';
    const uploadRateKey = await createApiKey(owner, ['inbox:write']);
    const ratePayload = { ...payload, relativePath: 'rate-limited.raw' };
    assert.equal((await uploadFileStream({ ...ratePayload, apiKey: uploadRateKey.key })).statusCode, 201);
    assert.equal((await uploadFileStream({ ...ratePayload, apiKey: uploadRateKey.key })).statusCode, 429);
    process.env.API_KEY_RATE_LIMIT = '120';

    process.env.STORAGE_PROVIDER = 'invalid';
    const serverFailure = await uploadFileStream({ ...payload, relativePath: 'server-error.raw' });
    process.env.STORAGE_PROVIDER = 'local';
    assert.equal(serverFailure.statusCode, 500);

    process.env.INBOX_UPLOAD_TIMEOUT_MS = '40';
    const timeoutStatus = await new Promise((resolve, reject) => {
      const boundary = 'phase3-timeout-boundary';
      const req = httpRequest(`${api}/v1/inbox/files`, { method: 'POST', headers: { Authorization: `Bearer ${fullKey.key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.write(`--${boundary}\r\nContent-Disposition: form-data; name="instrumentId"\r\n\r\nslow`);
      setTimeout(() => req.destroy(), 1500).unref();
    });
    process.env.INBOX_UPLOAD_TIMEOUT_MS = '120000';
    assert.equal(timeoutStatus, 408);
    await rm(tempDir, { recursive: true, force: true });
  });

  await t.test('Session inbox attach and dismiss enforce note permissions and locks', async () => {
    const inbox = await InboxFile.findOne({ status: 'new' }).sort({ createdAt: 1 });
    assert.ok(inbox);
    assert.equal((await call('GET', '/inbox')).status, 401);
    assert.equal((await call('GET', '/inbox', undefined, researcher)).status, 200);
    const note = await Note.findById(projectNote._id);
    assert.equal((await call('POST', `/inbox/${inbox._id}/attach`, { noteId: 'invalid-id', version: note.version }, researcher)).status, 400);
    assert.equal((await call('POST', `/inbox/${inbox._id}/attach`, { noteId: String(note._id), version: note.version }, viewer)).status, 403);
    const attached = await call('POST', `/inbox/${inbox._id}/attach`, { noteId: String(note._id), version: note.version }, researcher);
    assert.equal(attached.status, 201, JSON.stringify(attached.data));
    const attachment = await FileAttachment.findById(attached.data.file.id);
    assert.equal(attachment.storageKey, inbox.storageKey);
    assert.equal((await InboxFile.findById(inbox._id)).status, 'attached');
    assert.equal((await call('POST', `/inbox/${inbox._id}/attach`, { noteId: String(note._id), version: attached.data.version }, researcher)).status, 404);

    const dismissKey = await createApiKey(researcher, ['inbox:write']);
    const dismissBytes = Buffer.from('dismissible inbox payload');
    const dismissStorageKey = await put(Readable.from(dismissBytes), { key: `inbox/dismiss-${crypto.randomUUID()}` });
    const [dismissible] = await InboxFile.create([{ instrumentId: 'DISMISS-TEST', relativePath: 'phase3/dismiss.txt', capturedAt: new Date(), sha256: crypto.createHash('sha256').update(dismissBytes).digest('hex'), size: dismissBytes.length, storageKey: dismissStorageKey, uploadedByKey: dismissKey.id }]);
    assert.equal((await call('POST', `/inbox/${dismissible._id}/dismiss`, {}, researcher)).status, 200);
    assert.equal((await InboxFile.findById(dismissible._id)).status, 'dismissed');
    assert.equal((await call('POST', `/inbox/${dismissible._id}/dismiss`, {}, researcher)).status, 404);
  });

  await t.test('Storage local provider and migration preserve hashes and source files', async () => {
    const legacyPath = path.join(dataDir, 'legacy-attachment.bin');
    const bytes = Buffer.from('legacy stored bytes'); await writeFile(legacyPath, bytes);
    const note = await Note.create({ title: 'storage migration note', authorId: researcher._id, author: researcher.name });
    const [legacy] = await FileAttachment.create([{ filename: 'legacy-attachment.bin', originalName: 'legacy.bin', mimeType: 'application/octet-stream', size: bytes.length, path: legacyPath, noteId: note._id, uploadedBy: researcher._id, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }]);
    const env = { ...process.env, MONGO_URI: repl.getUri(), DB_NAME: 'phase3', NODE_ENV: 'test', DATA_DIR: dataDir, STORAGE_PROVIDER: 'local' };
    const dry = await execFile(process.execPath, ['scripts/migrate-storage.js'], { cwd: root, env });
    assert.match(dry.stdout, /"mode":"dry-run"/); assert.equal((await FileAttachment.findById(legacy._id)).storageKey, undefined);
    await execFile(process.execPath, ['scripts/migrate-storage.js', '--apply'], { cwd: root, env });
    const migrated = await FileAttachment.findById(legacy._id);
    assert.match(migrated.storageKey, /^attachments\//); assert.equal(migrated.path, legacyPath);
    assert.equal((await readStored(migrated)).toString(), bytes.toString());
    assert.equal(await hashFile(legacyPath), migrated.sha256, 'migration leaves the original source intact');

    const data = Buffer.from('local storage conformance');
    const key = await put(Readable.from(data), { key: 'conformance/local.txt', contentType: 'text/plain' });
    assert.deepEqual(await stat(key), { size: data.length }); assert.deepEqual(await readStored({ storageKey: key }), data);
    await remove(key); await assert.rejects(() => stat(key));
  });

  await t.test('Webhook secret rotation, HMAC signature, retries, and SSRF address checks', async () => {
    let responseStatus = 200, captured, slowDrip = false, slowTimer;
    const receiver = createServer((req, res) => {
      const chunks = []; req.on('data', (chunk) => chunks.push(chunk)); req.on('end', () => {
        captured = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
        if (slowDrip) {
          res.writeHead(responseStatus); res.write('slow');
          slowTimer = setInterval(() => { if (!res.destroyed) res.write('.'); }, 20);
          res.on('close', () => clearInterval(slowTimer));
          return;
        }
        res.statusCode = responseStatus; res.end('ok');
      });
    });
    await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    try {
      const created = await call('POST', '/webhooks', { url: `http://127.0.0.1:${receiver.address().port}/events`, events: ['inbox.received'] }, admin);
      assert.equal(created.status, 201); assert.ok(created.data.secret);
      const listed = await call('GET', '/webhooks', undefined, admin);
      assert.equal('secret' in listed.data[0], false); assert.equal('secretEncrypted' in listed.data[0], false);
      const hook = await Webhook.findById(created.data.id);
      const rotated = await call('POST', `/webhooks/${created.data.id}/rotate-secret`, {}, admin);
      assert.equal(rotated.status, 200); assert.ok(rotated.data.secret); assert.notEqual(rotated.data.secret, created.data.secret);
      const payload = { inboxId: 'test-1', instrumentId: 'LCMS' };
      const [delivery] = await WebhookDelivery.create([{ webhookId: hook._id, event: 'inbox.received', payload, attempts: 1, nextAttemptAt: new Date() }]);
      await deliverWebhookOnce(delivery);
      const sent = await WebhookDelivery.findById(delivery._id);
      assert.equal(sent.status, 'delivered'); assert.equal(captured.headers['x-labhub-event'], 'inbox.received');
      assert.equal(captured.headers['x-labhub-delivery'], String(delivery._id));
      const expected = `sha256=${crypto.createHmac('sha256', rotated.data.secret).update(captured.body).digest('hex')}`;
      assert.equal(captured.headers['x-labhub-signature'], expected);

      responseStatus = 503;
      const [retry] = await WebhookDelivery.create([{ webhookId: hook._id, event: 'inbox.received', payload, attempts: 1, nextAttemptAt: new Date() }]);
      await deliverWebhookOnce(retry); assert.equal((await WebhookDelivery.findById(retry._id)).status, 'pending');
      const [finalRetry] = await WebhookDelivery.create([{ webhookId: hook._id, event: 'inbox.received', payload, attempts: 10, nextAttemptAt: new Date() }]);
      await deliverWebhookOnce(finalRetry); assert.equal((await WebhookDelivery.findById(finalRetry._id)).status, 'failed');

      responseStatus = 200; slowDrip = true; process.env.WEBHOOK_DELIVERY_TIMEOUT_MS = '120';
      const [slowDelivery] = await WebhookDelivery.create([{ webhookId: hook._id, event: 'inbox.received', payload, attempts: 1, nextAttemptAt: new Date() }]);
      const started = Date.now(); await deliverWebhookOnce(slowDelivery); const elapsed = Date.now() - started;
      const timedOut = await WebhookDelivery.findById(slowDelivery._id);
      assert.equal(timedOut.status, 'pending'); assert.match(timedOut.lastError, /deadline exceeded/); assert.ok(elapsed < 1000, `delivery took ${elapsed}ms`);
      delete process.env.WEBHOOK_DELIVERY_TIMEOUT_MS; slowDrip = false;
    } finally { await new Promise((resolve) => receiver.close(resolve)); }
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      for (const url of ['https://localhost/events', 'https://127.0.0.1/events', 'https://[::1]/events', 'http://localhost/events']) assert.throws(() => validateWebhookUrl(url), (error) => error.status === 400);
      assert.equal(validateWebhookUrl('https://hooks.example.test/events').protocol, 'https:');
      assert.throws(() => validateResolvedAddresses([{ address: '127.0.0.1', family: 4 }], false), /non-public/);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    }
    assert.throws(() => validateResolvedAddresses([{ address: '127.0.0.1', family: 4 }]), /non-public/);
    assert.throws(() => validateResolvedAddresses([{ address: '10.0.0.2', family: 4 }]), /non-public/);
    assert.throws(() => validateResolvedAddresses([{ address: '169.254.169.254', family: 4 }]), /non-public/);
    assert.throws(() => validateResolvedAddresses([{ address: '::1', family: 6 }]), /non-public/);
    assert.equal(validateResolvedAddresses([{ address: '127.0.0.1', family: 4 }], true).address, '127.0.0.1');
    assert.equal(validateResolvedAddresses([{ address: '8.8.8.8', family: 4 }]).address, '8.8.8.8');
  });

  await t.test('S3 adapter conformance against a real MinIO container on an ephemeral host port', async (t) => {
    try { await execFile('docker', ['info', '--format', '{{.ServerVersion}}']); }
    catch (error) { return t.skip(`Docker unavailable: ${error.message}`); }
    const container = `labhub-phase3-minio-${crypto.randomBytes(4).toString('hex')}`;
    const user = 'labhubtest', secret = 'phase3-minio-secret-1234567890';
    let regionClient;
    try {
      await execFile('docker', ['run', '--rm', '-d', '--name', container, '-e', 'HOME=/tmp', '-e', `MINIO_ROOT_USER=${user}`, '-e', `MINIO_ROOT_PASSWORD=${secret}`, '-p', '127.0.0.1::9000', 'quay.io/ricardbejarano/minio:RELEASE.2024-11-07T00-52-20Z', 'server', '/data']);
      const mapped = await execFile('docker', ['port', container, '9000/tcp']);
      const hostPort = Number(/:(\d+)\s*$/.exec(mapped.stdout.trim())?.[1]); assert.ok(hostPort > 0 && ![5000,5173,5099].includes(hostPort));
      const { S3Client, CreateBucketCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const endpoint = `http://127.0.0.1:${hostPort}`;
      regionClient = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: user, secretAccessKey: secret } });
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt++) {
        try { await regionClient.send(new CreateBucketCommand({ Bucket: 'phase3-contract' })); ready = true; }
        catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
      }
      assert.equal(ready, true, 'MinIO accepted the bucket creation');
      Object.assign(process.env, { STORAGE_PROVIDER: 's3', S3_ENDPOINT: endpoint, S3_BUCKET: 'phase3-contract', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: user, S3_SECRET_ACCESS_KEY: secret, S3_FORCE_PATH_STYLE: 'true' });
      assert.deepEqual((await call('GET', '/health/ready')).data, { status: 'ok', database: true, storage: true });
      const healthObjects = await regionClient.send(new ListObjectsV2Command({ Bucket: 'phase3-contract', Prefix: 'health/' }));
      assert.equal(healthObjects.KeyCount, 0, 'readiness uses a non-mutating bucket check');
      const bytes = Buffer.from('MinIO streaming conformance');
      const key = await put(Readable.from(bytes), { key: 'conformance/minio.txt', contentType: 'text/plain' });
      assert.equal((await stat(key)).size, bytes.length); assert.deepEqual(await readStored({ storageKey: key }), bytes);
      await remove(key); await assert.rejects(() => stat(key));
    } finally {
      process.env.STORAGE_PROVIDER = 'local';
      regionClient?.destroy();
      await execFile('docker', ['rm', '-f', container]).catch(() => {});
    }
  });

  await t.test('OIDC fake issuer validates state, PKCE, nonce, verified email, and existing-account-only linking', async () => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = pair.publicKey.export({ format: 'jwk' });
    Object.assign(publicJwk, { kid: 'phase3-test-key', use: 'sig', alg: 'RS256' });
    let mode = 'valid', authorization, codeVerifier;
    const identity = createServer(async (req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          issuer: issuerUrl, authorization_endpoint: `${issuerUrl}/authorize`, token_endpoint: `${issuerUrl}/token`, jwks_uri: `${issuerUrl}/jwks`,
          response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'],
        }));
      }
      if (req.url === '/jwks') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ keys: [publicJwk] })); }
      if (req.url === '/token' && req.method === 'POST') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        codeVerifier = form.get('code_verifier');
        const challenge = crypto.createHash('sha256').update(codeVerifier || '').digest('base64url');
        assert.equal(challenge, authorization.searchParams.get('code_challenge'));
        const values = mode === 'unknown' ? { email: 'no-such-user@phase3.test', email_verified: true } : mode === 'unverified' ? { email: 'unverified@phase3.test', email_verified: false } : { email: researcher.email, email_verified: true };
        const nonce = mode === 'noncebad' ? 'wrong-nonce' : authorization.searchParams.get('nonce');
        const id_token = jwt.sign({ sub: `subject-${mode}`, email: values.email, email_verified: values.email_verified, nonce }, pair.privateKey, { algorithm: 'RS256', keyid: 'phase3-test-key', issuer: issuerUrl, audience: 'phase3-client', expiresIn: '5m' });
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ access_token: 'fake-access-token', token_type: 'Bearer', expires_in: 300, id_token }));
      }
      res.statusCode = 404; res.end();
    });
    await new Promise((resolve) => identity.listen(0, '127.0.0.1', resolve));
    const issuerUrl = `http://127.0.0.1:${identity.address().port}`;
    Object.assign(process.env, { OIDC_ISSUER: issuerUrl, OIDC_CLIENT_ID: 'phase3-client', OIDC_CLIENT_SECRET: 'phase3-client-secret', OIDC_REDIRECT_URI: `${api}/auth/oidc/callback`, OIDC_LABEL: '기관 SSO' });
    async function startLogin() {
      const response = await fetch(api + '/auth/oidc/start', { redirect: 'manual' });
      assert.equal(response.status, 302);
      authorization = new URL(response.headers.get('location'));
      const cookieHeader = response.headers.get('set-cookie') || '';
      const stateCookie = /oidc_login_state=([^;]+)/.exec(cookieHeader)?.[1];
      assert.ok(stateCookie);
      return { state: authorization.searchParams.get('state'), nonce: authorization.searchParams.get('nonce'), stateCookie };
    }
    async function callback(login, code = 'code') {
      return fetch(`${api}/auth/oidc/callback?code=${code}&state=${encodeURIComponent(login.state)}`, { redirect: 'manual', headers: { Cookie: `oidc_login_state=${login.stateCookie}` } });
    }
    try {
      assert.deepEqual((await call('GET', '/auth/providers')).data, { oidc: { enabled: true, label: '기관 SSO' } });
      const wrongState = await startLogin();
      const rejectedState = await fetch(`${api}/auth/oidc/callback?code=x&state=wrong`, { headers: { Cookie: `oidc_login_state=${wrongState.stateCookie}` } });
      assert.equal(rejectedState.status, 400);

      mode = 'unverified'; const unverified = await startLogin();
      assert.equal((await callback(unverified, 'unverified')).status, 403);
      assert.equal(await User.countDocuments({ email: 'unverified@phase3.test' }), 0);

      mode = 'unknown'; const unknown = await startLogin();
      assert.equal((await callback(unknown, 'unknown')).status, 403);
      assert.equal(await User.countDocuments({ email: 'no-such-user@phase3.test' }), 0);

      mode = 'noncebad'; const nonce = await startLogin();
      assert.notEqual((await callback(nonce, 'noncebad')).status, 303);

      mode = 'valid'; researcher.mfaEnabled = true; await researcher.save();
      const valid = await startLogin();
      const completed = await callback(valid, 'valid');
      assert.equal(completed.status, 303);
      const session = /labhub_session=([^;]+)/.exec(completed.headers.get('set-cookie') || '')?.[1];
      assert.ok(session);
      const me = await fetch(api + '/auth/me', { headers: { Cookie: `labhub_session=${session}` } });
      assert.equal(me.status, 200); assert.equal((await User.findById(researcher._id)).oidcSubject, 'subject-valid');
      assert.equal((await call('POST', '/auth/login', { email: researcher.email, password })).status, 401);
      const reused = await fetch(`${api}/auth/oidc/callback?code=valid&state=${encodeURIComponent(valid.state)}`, { headers: { Cookie: `oidc_login_state=${valid.stateCookie}` } });
      assert.equal(reused.status, 400);
      researcher.mfaEnabled = false; await researcher.save();
    } finally {
      await new Promise((resolve) => identity.close(resolve));
      for (const key of ['OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET','OIDC_REDIRECT_URI','OIDC_LABEL']) delete process.env[key];
    }
  });

  await t.test('Backup and restore retain Phase 3 collections and all stored file classes', async () => {
    const inboxKey = await createApiKey(researcher, ['inbox:write']);
    const inboxBytes = Buffer.from('phase3 backup inbox bytes');
    const inboxHash = crypto.createHash('sha256').update(inboxBytes).digest('hex');
    const inboxStorageKey = await put(Readable.from(inboxBytes), { key: `inbox/backup-${crypto.randomUUID()}` });
    const [backupInbox] = await InboxFile.create([{ instrumentId: 'BACKUP-TEST', relativePath: 'phase3/inbox.txt', capturedAt: new Date(), sha256: inboxHash, size: inboxBytes.length, storageKey: inboxStorageKey, uploadedByKey: inboxKey.id }]);

    const attachmentBytes = Buffer.from('phase3 backup attachment bytes');
    const attachmentHash = crypto.createHash('sha256').update(attachmentBytes).digest('hex');
    const attachmentKey = await put(Readable.from(attachmentBytes), { key: `attachments/backup-${crypto.randomUUID()}` });
    const [backupAttachment] = await FileAttachment.create([{ filename: 'backup-attachment.bin', originalName: 'backup-attachment.bin', mimeType: 'application/octet-stream', size: attachmentBytes.length, storageKey: attachmentKey, noteId: projectNote._id, uploadedBy: researcher._id, sha256: attachmentHash }]);

    const sealBytes = Buffer.from('%PDF-1.4\nphase3 backup seal\n%%EOF');
    const sealHash = crypto.createHash('sha256').update(sealBytes).digest('hex');
    const sealKey = await put(Readable.from(sealBytes), { key: `seals/backup-${crypto.randomUUID()}.pdf`, contentType: 'application/pdf' });
    const [backupSeal] = await NoteSeal.create([{ verifyId: crypto.randomBytes(16).toString('base64url'), noteId: projectNote._id, noteVersion: 1, manifest: { schemaVersion: 2, title: 'Phase 3 backup' }, manifestSha256: crypto.createHash('sha256').update('manifest').digest('hex'), storageKey: sealKey, pdfSha256: sealHash, signatures: [], sealHash: crypto.randomBytes(32).toString('hex'), timestamp: { status: 'not_configured' } }]);
    await OidcLoginState.create({ state: crypto.randomBytes(16).toString('hex'), nonce: crypto.randomBytes(16).toString('hex'), verifier: crypto.randomBytes(32).toString('base64url'), expiresAt: new Date(Date.now() + 60_000) });

    const destination = path.join(dataDir, 'phase3-backup');
    const restoreDataDir = path.join(dataDir, 'phase3-restored-data');
    const backupResult = await backup(destination);
    const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, 4);
    assert.ok(backupResult.collections >= 30);
    assert.ok(manifest.files.some((file) => file.type === 'attachment'));
    assert.ok(manifest.files.some((file) => file.type === 'seal'));
    assert.ok(manifest.files.some((file) => file.type === 'inbox'));

    const restoreCheck = `
      import mongoose from 'mongoose';
      import { restore } from './lib/backup.js';
      import { openFile } from './lib/storage/index.js';
      await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.DB_NAME });
      await restore(process.env.RESTORE_SOURCE);
      const db = mongoose.connection.db;
      const collections = ['locations','entitytypes','entities','bookings','apikeys','inboxfiles','webhooks','webhookdeliveries','oidcloginstates'];
      const counts = Object.fromEntries(await Promise.all(collections.map(async (name) => [name, await db.collection(name).countDocuments()])));
      const find = async (name, id) => db.collection(name).findOne({ _id: new mongoose.Types.ObjectId(id) });
      const contents = async (record) => { const chunks = []; for await (const chunk of await openFile(record)) chunks.push(chunk); return Buffer.concat(chunks).toString('base64'); };
      const attachment = await find('fileattachments', process.env.ATTACHMENT_ID);
      const seal = await find('noteseals', process.env.SEAL_ID);
      const inbox = await find('inboxfiles', process.env.INBOX_ID);
      console.log(JSON.stringify({ counts, attachment: await contents(attachment), seal: await contents(seal), inbox: await contents(inbox) }));
      await mongoose.disconnect();
    `;
    const env = {
      ...process.env, NODE_ENV: 'test', STORAGE_PROVIDER: 'local', MONGO_URI: repl.getUri(), DB_NAME: 'phase3_restore_test', DATA_DIR: restoreDataDir,
      RESTORE_SOURCE: destination, ATTACHMENT_ID: String(backupAttachment._id), SEAL_ID: String(backupSeal._id), INBOX_ID: String(backupInbox._id),
    };
    const restored = await execFile(process.execPath, ['--input-type=module', '-e', restoreCheck], { cwd: root, env });
    const result = JSON.parse(restored.stdout.trim());
    for (const name of ['locations','entitytypes','entities','bookings','apikeys','inboxfiles','webhooks','webhookdeliveries','oidcloginstates']) assert.ok(result.counts[name] > 0, `${name} restored`);
    assert.equal(Buffer.from(result.attachment, 'base64').toString(), attachmentBytes.toString());
    assert.equal(Buffer.from(result.seal, 'base64').toString(), sealBytes.toString());
    assert.equal(Buffer.from(result.inbox, 'base64').toString(), inboxBytes.toString());
  });
});
