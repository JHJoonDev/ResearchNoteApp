import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PNG } from 'pngjs';
import { unzipSync } from 'fflate';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as createSmtpServer } from 'node:net';
import { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { SCHEMA_VERSION } from '@labhub/note-format';

const execFile = promisify(execFileCallback);
const dir = await mkdtemp(path.join(os.tmpdir(), 'labhub-phase2-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = 'phase2-only-testing-secret-at-least-32-characters';
process.env.PUBLIC_BASE_URL = 'https://labhub.example.test';
process.env.SEARCH_PROVIDER = 'memory';
process.env.MAIL_PROVIDER = 'smtp';
process.env.SMTP_HOST = '127.0.0.1';
process.env.MAIL_FROM = 'labhub@example.test';
delete process.env.ALLOW_LEGACY_ELN_WRITES;

const sent = [];
const smtpCapture = createSmtpServer((socket) => {
  let buffer = '';
  let dataLines = null;
  let recipient = '';
  socket.setEncoding('utf8');
  socket.write('220 localhost ESMTP ready\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk;
    while (true) {
      const end = buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (dataLines) {
        if (line === '.') {
          const raw = dataLines.join('\r\n');
          const split = raw.indexOf('\r\n\r\n');
          const headers = split < 0 ? raw : raw.slice(0, split);
          const body = split < 0 ? '' : raw.slice(split + 4).replace(/=\r\n/g, '').replace(/=([\da-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
          sent.push({ to: recipient, subject: /^Subject:\s*(.*)$/im.exec(headers)?.[1] || '', text: body, html: '', createdAt: new Date().toISOString() });
          dataLines = null;
          socket.write('250 queued\r\n');
        } else dataLines.push(line.startsWith('..') ? line.slice(1) : line);
        continue;
      }
      const command = line.split(' ', 1)[0].toUpperCase();
      if (command === 'EHLO' || command === 'HELO') socket.write('250-localhost\r\n250 PIPELINING\r\n');
      else if (command === 'MAIL') socket.write('250 sender ok\r\n');
      else if (command === 'RCPT') { recipient = /<([^>]+)>/.exec(line)?.[1] || ''; socket.write('250 recipient ok\r\n'); }
      else if (command === 'DATA') { dataLines = []; socket.write('354 end with dot\r\n'); }
      else if (command === 'RSET') socket.write('250 reset\r\n');
      else if (command === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
});
await new Promise((resolve) => smtpCapture.listen(0, '127.0.0.1', resolve));
process.env.SMTP_PORT = String(smtpCapture.address().port);

const { app } = await import('../app.js');
const { jwtSecret } = await import('../config.js');
const User = (await import('../models/User.js')).default;
const Project = (await import('../models/Project.js')).default;
const Note = (await import('../models/ElnNote.js')).default;
const Version = (await import('../models/ElnVersion.js')).default;
const AuditLog = (await import('../models/AuditLog.js')).default;
const Experiment = (await import('../models/Experiment.js')).default;
const Protocol = (await import('../models/Protocol.js')).default;
const ProtocolVersion = (await import('../models/ProtocolVersion.js')).default;
const Comment = (await import('../models/Comment.js')).default;
const Notification = (await import('../models/Notification.js')).default;
const Presence = (await import('../models/NotePresence.js')).default;
const AccountToken = (await import('../models/AccountToken.js')).default;
const Attachment = (await import('../models/FileAttachment.js')).default;
const Item = (await import('../models/LimsItem.js')).default;
const SigningKey = (await import('../models/UserSigningKey.js')).default;
const Seal = (await import('../models/NoteSeal.js')).default;
const { backup, restore } = await import('../lib/backup.js');
const { searchIndex, indexNoteAfterCommit } = await import('../lib/search.js');
const { MAX_CONTENT_DOC_BYTES } = await import('../lib/note-doc.js');
const { canonicalize } = await import('../lib/canonical.js');
const { openFile } = await import('../lib/storage/index.js');
async function readStored(record) { const chunks = []; for await (const chunk of await openFile(record)) chunks.push(chunk); return Buffer.concat(chunks); }

const repl = await MongoMemoryReplSet.create({
  binary: { downloadDir: fileURLToPath(new URL('../node_modules/.cache/mongodb-memory-server', import.meta.url)) },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
await mongoose.connect(repl.getUri(), { dbName: 'phase2' });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const pass = 'Phase2-test-password-2026';
let authorPass = pass;

function token(user) {
  return jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion || 0, scope: 'session' }, jwtSecret, { algorithm: 'HS256', expiresIn: '12h' });
}
async function call(method, url, body, user = null) {
  const response = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(user ? { Cookie: `labhub_session=${token(user)}` } : {}),
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'X-LabHub-Request': '1' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await response.json(); } catch { /* status-only assertion */ }
  return { status: response.status, data, cookie: response.headers.get('set-cookie'), headers: response.headers };
}
async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test background work.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function doc(text = 'Phase two content') {
  return { type: 'doc', schemaVersion: SCHEMA_VERSION, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}
async function newUser(name, role) {
  return User.create({ name, email: `${name}@example.test`, password: await bcrypt.hash(pass, 4), role });
}
async function createNote(user, extra = {}) {
  return call('POST', '/eln', { title: 'Phase 2 note', contentFormat: 'doc', contentDoc: doc(), ...extra }, user);
}

await test('Phase 2 backend contract and regression coverage', async (t) => {
  let admin, author, manager, viewer, outsider, nonmember, projectViewer, project;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => smtpCapture.close(resolve));
    await mongoose.disconnect();
    await repl.stop();
    if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('labhub-phase2-')) await rm(dir, { recursive: true, force: true });
  });

  admin = await newUser('admin-phase2', 'admin');
  author = await newUser('author-phase2', 'researcher');
  manager = await newUser('manager-phase2', 'researcher');
  viewer = await newUser('viewer-phase2', 'viewer');
  outsider = await newUser('outsider-phase2', 'researcher');
  nonmember = await newUser('nonmember-phase2', 'researcher');
  projectViewer = await newUser('project-viewer-phase2', 'researcher');
  project = await Project.create({ name: 'Phase 2 project', members: [
    { userId: author._id, name: author.name, role: 'editor' },
    { userId: manager._id, name: manager.name, role: 'manager' },
    { userId: viewer._id, name: viewer.name, role: 'viewer' },
    { userId: outsider._id, name: outsider.name, role: 'editor' },
    { userId: projectViewer._id, name: projectViewer.name, role: 'viewer' },
  ] });

  await t.test('Block document write, legacy conversion, and 8 MB ELN parser', async () => {
    assert.equal((await call('POST', '/eln', { title: 'legacy', content: '<p>blocked</p>' }, author)).status, 400);
    assert.equal((await call('POST', '/eln', { title: 'invalid', contentDoc: { type: 'not-doc' } }, author)).status, 400);
    const created = await createNote(author, { title: 'Doc note', projectId: String(project._id) });
    assert.equal(created.status, 201);
    assert.equal(created.data.contentFormat, 'doc');
    assert.match(created.data.content, /Phase two content/);
    const full = await call('GET', `/eln/${created.data.id}`, undefined, author);
    assert.equal(full.status, 200);
    assert.equal(full.data.contentDoc.type, 'doc');
    assert.deepEqual(full.data.conversionWarnings, []);
    const converted = await call('POST', '/eln/convert-html', { html: '<h2>Legacy</h2><p>Draft</p>' }, author);
    assert.equal(converted.status, 200);
    assert.equal(converted.data.doc.type, 'doc');
    const legacy = await Note.create({ authorId: author._id, author: author.name, title: 'legacy stored row', content: '<p>unchanged source</p>', contentFormat: 'html' });
    const legacyRead = await call('GET', `/eln/${legacy._id}`, undefined, author);
    assert.equal(legacyRead.status, 200);
    assert.equal(legacyRead.data.contentFormat, 'html');
    assert.equal(legacyRead.data.contentDoc.type, 'doc');
    assert.ok(Array.isArray(legacyRead.data.conversionWarnings));
    const afterRead = await Note.findById(legacy._id).lean();
    assert.equal(afterRead.content, '<p>unchanged source</p>');
    assert.equal(afterRead.contentDoc, undefined);
    const bigText = 'x'.repeat(4 * 1024 * 1024 + 128);
    const body = JSON.stringify({ title: 'large eln payload', contentDoc: doc(bigText) });
    const elnResult = await fetch(base + '/eln', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `labhub_session=${token(author)}`, 'X-LabHub-Request': '1' }, body });
    assert.equal(elnResult.status, 413, 'ELN body parser accepts >4 MB before canonical document size validation');
    const authResult = await fetch(base + '/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LabHub-Request': '1' }, body: JSON.stringify({ email: 'x'.repeat(4 * 1024 * 1024 + 128) }) });
    assert.equal(authResult.status, 413, 'non-ELN JSON body remains capped at 4 MB');
  });

  await t.test('Maximum-size document survives create, update, version, and hashed audit', async () => {
    const emptySize = Buffer.byteLength(canonicalize(doc('')));
    const maxText = '&'.repeat(MAX_CONTENT_DOC_BYTES - emptySize - 64);
    const maxDoc = doc(maxText);
    assert.ok(Buffer.byteLength(canonicalize(maxDoc)) <= MAX_CONTENT_DOC_BYTES);
    const created = await createNote(author, { title: 'Maximum document', projectId: String(project._id), contentDoc: maxDoc });
    assert.equal(created.status, 201);
    const createdRow = await Note.findById(created.data.id).lean();
    assert.ok(mongoose.mongo.BSON.calculateObjectSize(createdRow) < 16 * 1024 * 1024);
    const createAudit = await AuditLog.findOne({ targetId: created.data.id, action: 'CREATE' }).lean();
    assert.equal('content' in createAudit.newState, false);
    assert.equal('contentDoc' in createAudit.newState, false);
    assert.match(createAudit.newState.contentSha256, /^[a-f0-9]{64}$/);
    assert.match(createAudit.newState.contentDocSha256, /^[a-f0-9]{64}$/);

    const updated = await call('PUT', `/eln/${created.data.id}`, { title: 'Maximum document v2', projectId: String(project._id), contentDoc: maxDoc, version: created.data.version, changeReason: 'large document update' }, author);
    assert.equal(updated.status, 200);
    const version = await Version.findOne({ noteId: created.data.id, version: created.data.version }).lean();
    assert.ok(mongoose.mongo.BSON.calculateObjectSize(version) < 16 * 1024 * 1024);
    assert.equal('content' in version.snapshot, false);
    assert.equal('contentDoc' in version.snapshot, false);
    const updateAudit = await AuditLog.findOne({ targetId: created.data.id, action: 'UPDATE' }).sort({ createdAt: -1 }).lean();
    for (const state of [updateAudit.previousState, updateAudit.newState]) {
      assert.equal('content' in state, false);
      assert.equal('contentDoc' in state, false);
      assert.match(state.contentSha256, /^[a-f0-9]{64}$/);
      assert.match(state.contentDocSha256, /^[a-f0-9]{64}$/);
    }
    const oversized = await createNote(author, { title: 'Too large', contentDoc: doc('x'.repeat(MAX_CONTENT_DOC_BYTES + 1)) });
    assert.equal(oversized.status, 413);
  });

  await t.test('Public account and verification routes do not require a cookie', async () => {
    const setup = await call('GET', '/auth/setup');
    assert.equal(setup.status, 200);
    assert.equal(typeof setup.data.required, 'boolean');
    const reset = await call('POST', '/auth/password-reset/request', { email: 'not-found@example.test' });
    assert.equal(reset.status, 200);
    assert.equal((await call('POST', '/auth/invitation/inspect', { token: 'invalid' })).status, 400);
    assert.equal((await call('GET', '/public/verify/not-a-real-seal')).status, 404);
  });

  await t.test('Document references, reagent existence, and attachment locks', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const imageDoc = { type: 'doc', schemaVersion: SCHEMA_VERSION, content: [{ type: 'image', attrs: { attachmentId: fakeId, alt: 'missing' } }] };
    assert.equal((await createNote(author, { contentDoc: imageDoc, projectId: String(project._id) })).status, 400);
    const missingReagent = { type: 'doc', schemaVersion: SCHEMA_VERSION, content: [{ type: 'paragraph', content: [{ type: 'reagentRef', attrs: { reagentId: fakeId, label: 'reagent' } }] }] };
    assert.equal((await createNote(author, { contentDoc: missingReagent, projectId: String(project._id) })).status, 400);
    assert.equal((await createNote(author, { projectId: String(project._id), experimentId: { $ne: null } })).status, 400);
    const item = await Item.create({ name: 'Reagent phase2', stockValue: 10, unit: 'mL' });
    const validReagent = { type: 'doc', schemaVersion: SCHEMA_VERSION, content: [{ type: 'paragraph', content: [{ type: 'reagentRef', attrs: { reagentId: String(item._id), label: 'client label' } }] }] };
    assert.equal((await createNote(author, { contentDoc: validReagent, projectId: String(project._id) })).status, 201);
    const note = (await createNote(author, { projectId: String(project._id) })).data;
    const filePath = path.join(dir, 'reference.txt');
    await writeFile(filePath, 'reference fixture');
    const file = await Attachment.create({ noteId: note.id, filename: 'reference.txt', originalName: 'reference.txt', mimeType: 'text/plain', size: 17, path: filePath, sha256: crypto.createHash('sha256').update('reference fixture').digest('hex'), uploadedBy: author._id });
    const attachedDoc = { type: 'doc', schemaVersion: SCHEMA_VERSION, content: [{ type: 'image', attrs: { attachmentId: String(file._id), alt: 'image' } }] };
    const saved = await call('PUT', `/eln/${note.id}`, { title: note.title, projectId: String(project._id), contentDoc: attachedDoc, version: note.version, changeReason: 'attach reference' }, author);
    assert.equal(saved.status, 200);
    const deleted = await call('DELETE', `/files/${file._id}`, { version: saved.data.version }, author);
    assert.equal(deleted.status, 409);
    const badProject = await Project.create({ name: 'Other project', members: [{ userId: author._id, name: author.name, role: 'manager' }] });
    const experiment = (await call('POST', `/projects/${project._id}/experiments`, { name: 'Run 1' }, author)).data;
    assert.equal((await call('PUT', `/eln/${note.id}`, { title: note.title, projectId: String(badProject._id), experimentId: String(experiment._id), contentDoc: attachedDoc, version: saved.data.version, changeReason: 'wrong project' }, author)).status, 400);
  });

  await t.test('Experiments and immutable protocol runs with result validation', async () => {
    const experiment = await call('POST', `/projects/${project._id}/experiments`, { name: 'Cell assay', description: 'description' }, author);
    assert.equal(experiment.status, 201);
    assert.equal((await call('GET', `/projects/${project._id}/experiments`, undefined, viewer)).status, 200);
    assert.equal((await call('POST', `/projects/${project._id}/experiments`, { name: 'denied' }, nonmember)).status, 403);
    const protocol = await call('POST', '/protocols', { projectId: String(project._id), title: 'Incubation', steps: [{ id: 's1', title: 'Incubate', instructions: '37 C', checklist: [{ id: 'c1', text: 'Start' }], resultFields: [{ id: 'f1', name: 'temperature', unit: 'C', kind: 'number' }] }] }, author);
    assert.equal(protocol.status, 201);
    assert.equal((await call('POST', '/protocols', { title: 'bad step', steps: [{ id: 's1', title: 5 }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'bad instructions', steps: [{ id: 's1', title: 'step', instructions: {} }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'bad checklist', steps: [{ id: 's1', title: 'step', checklist: [{ id: 'c1', text: 5 }] }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'bad result field', steps: [{ id: 's1', title: 'step', resultFields: [{ id: 'f1', name: ['temperature'], kind: 'number' }] }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'long step title', steps: [{ id: 's1', title: 'x'.repeat(201) }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'long instructions', steps: [{ id: 's1', title: 'step', instructions: 'x'.repeat(10001) }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'long checklist text', steps: [{ id: 's1', title: 'step', checklist: [{ id: 'c1', text: 'x'.repeat(501) }] }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'long result field name', steps: [{ id: 's1', title: 'step', resultFields: [{ id: 'f1', name: 'x'.repeat(201), kind: 'text' }] }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'long result field unit', steps: [{ id: 's1', title: 'step', resultFields: [{ id: 'f1', name: 'field', unit: 'x'.repeat(81), kind: 'number' }] }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'too many checklist items', steps: [{ id: 's1', title: 'step', checklist: Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, text: 'check' })) }] }, author)).status, 400);
    assert.equal((await call('POST', '/protocols', { title: 'too many result fields', steps: [{ id: 's1', title: 'step', resultFields: Array.from({ length: 101 }, (_, i) => ({ id: `f${i}`, name: 'field', kind: 'text' })) }] }, author)).status, 400);
    assert.equal((await call('PUT', `/protocols/${protocol.data._id}`, { title: 'Viewer edit', steps: [] }, projectViewer)).status, 403);
    assert.equal((await call('POST', `/protocols/${protocol.data._id}/publish`, {}, projectViewer)).status, 403);
    assert.equal((await call('DELETE', `/protocols/${protocol.data._id}`, {}, projectViewer)).status, 403);
    const unchangedProtocol = await Protocol.findById(protocol.data._id);
    assert.equal(unchangedProtocol.status, 'draft');
    assert.equal(unchangedProtocol.title, 'Incubation');
    const published = await call('POST', `/protocols/${protocol.data._id}/publish`, {}, author);
    assert.equal(published.status, 200);
    assert.equal(published.data.status, 'published');
    assert.equal((await ProtocolVersion.countDocuments({ protocolId: protocol.data._id, version: 1 })), 1);
    const noteResult = await createNote(author, { title: 'Protocol run note', projectId: String(project._id), experimentId: String(experiment.data._id), protocolId: String(protocol.data._id), protocolVersion: 1 });
    assert.equal(noteResult.status, 201);
    assert.equal((await createNote(author, { projectId: String(project._id), protocolId: { $ne: null }, protocolVersion: 1 })).status, 400);
    const note = noteResult.data;
    assert.equal(note.protocolRun.snapshot.title, 'Incubation');
    assert.equal(note.protocolRun.stepResults[0].stepId, 's1');
    const invalid = await call('PUT', `/eln/${note.id}`, { title: note.title, projectId: String(project._id), experimentId: String(experiment.data._id), contentDoc: note.contentDoc, protocolRun: { ...note.protocolRun, stepResults: [{ stepId: 's1', checked: ['unknown'], values: {} }] }, version: note.version, changeReason: 'invalid protocol result' }, author);
    assert.equal(invalid.status, 400);
    const valid = await call('PUT', `/eln/${note.id}`, { title: note.title, projectId: String(project._id), experimentId: String(experiment.data._id), contentDoc: note.contentDoc, protocolRun: { ...note.protocolRun, stepResults: [{ stepId: 's1', checked: ['c1'], values: { f1: 37 }, note: 'measured' }] }, version: note.version, changeReason: 'protocol result' }, author);
    assert.equal(valid.status, 200);
    assert.equal(valid.data.protocolRun.stepResults[0].values.f1, 37);
    const edited = await call('PUT', `/protocols/${protocol.data._id}`, { title: 'Incubation v2', steps: [{ id: 's1', title: 'Incubate', instructions: '40 C', checklist: [{ id: 'c1', text: 'Start' }], resultFields: [{ id: 'f1', name: 'temperature', unit: 'C', kind: 'number' }] }] }, author);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.version, 2);
    assert.equal(edited.data.status, 'draft');
    const stillFrozen = await call('GET', `/eln/${note.id}`, undefined, author);
    assert.equal(stillFrozen.data.protocolRun.snapshot.title, 'Incubation');
    assert.equal((await call('POST', `/protocols/${protocol.data._id}/publish`, {}, author)).status, 200);
    assert.equal((await call('GET', `/protocols/${protocol.data._id}/versions`, undefined, author)).data.length, 2);
  });

  await t.test('Version metadata, restore semantics, and concurrent save conflict', async () => {
    const note = (await createNote(author, { title: 'Versioned note', projectId: String(project._id) })).data;
    const update = await call('PUT', `/eln/${note.id}`, { title: 'Versioned note edited', projectId: String(project._id), contentDoc: doc('new body'), version: note.version, changeReason: 'edit body' }, author);
    assert.equal(update.status, 200);
    const versions = await call('GET', `/eln/${note.id}/versions`, undefined, author);
    assert.equal(versions.status, 200);
    assert.equal('contentDoc' in versions.data[0], false);
    assert.equal('content' in versions.data[0], false);
    assert.equal('snapshot' in versions.data[0], false);
    const fullVersion = await call('GET', `/eln/${note.id}/versions/1`, undefined, author);
    assert.equal(fullVersion.data.contentDoc.content[0].content[0].text, 'Phase two content');
    const restored = await call('POST', `/eln/${note.id}/restore-version`, { fromVersion: 1, version: update.data.version, reason: 'restore previous body' }, author);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.version, update.data.version + 1);
    assert.equal(restored.data.title, 'Versioned note');
    assert.equal(restored.data.contentDoc.content[0].content[0].text, 'Phase two content');
    assert.equal((await call('POST', `/eln/${note.id}/restore-version`, { fromVersion: 1, version: update.data.version, reason: 'stale version' }, author)).status, 409);

    const legacySnapshotNote = (await createNote(author, { title: 'Legacy snapshot restore', projectId: String(project._id) })).data;
    await Version.create({ noteId: legacySnapshotNote.id, version: 1, title: 'Legacy version', contentFormat: 'doc', content: '', snapshot: { title: 'Legacy snapshot body', contentFormat: 'doc', contentDoc: doc('restored from legacy snapshot'), content: '', authorId: author._id, author: author.name }, updaterName: author.name, changeReason: 'legacy row' });
    const legacyRestored = await call('POST', `/eln/${legacySnapshotNote.id}/restore-version`, { fromVersion: 1, version: legacySnapshotNote.version, reason: 'restore old snapshot' }, author);
    assert.equal(legacyRestored.status, 200);
    assert.equal(legacyRestored.data.contentDoc.content[0].content[0].text, 'restored from legacy snapshot');

    const conflictNote = (await createNote(author, { title: 'Concurrent note', projectId: String(project._id) })).data;
    const results = await Promise.all([
      call('PUT', `/eln/${conflictNote.id}`, { title: conflictNote.title, projectId: String(project._id), contentDoc: doc('writer a'), version: conflictNote.version, changeReason: 'writer a' }, author),
      call('PUT', `/eln/${conflictNote.id}`, { title: conflictNote.title, projectId: String(project._id), contentDoc: doc('writer b'), version: conflictNote.version, changeReason: 'writer b' }, author),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  });

  await t.test('Comments, notifications, review queue, and presence permissions', async () => {
    const note = (await createNote(author, { title: 'Collaboration note', projectId: String(project._id) })).data;
    await Note.updateOne({ _id: note.id }, { $set: { status: '승인됨' } });
    assert.equal((await call('GET', `/eln/${note.id}/comments`, undefined, viewer)).status, 200);
    assert.equal((await call('POST', `/eln/${note.id}/comments`, { body: 'viewer blocked' }, viewer)).status, 403);
    const comment = await call('POST', `/eln/${note.id}/comments`, { body: 'mention manager', mentions: [String(manager._id), String(nonmember._id)] }, author);
    assert.equal(comment.status, 201);
    assert.equal(comment.data.mentions.length, 1);
    const mentionNote = (await createNote(author, { title: 'Mention notification note', projectId: String(project._id) })).data;
    const mentionDoc = (users) => ({ type: 'doc', schemaVersion: SCHEMA_VERSION, content: [{ type: 'paragraph', content: users.map((user) => ({ type: 'mention', attrs: { userId: String(user._id), label: user.name } })) }] });
    let mentionVersion = mentionNote.version;
    const updateMentions = async (users) => call('PUT', `/eln/${mentionNote.id}`, { title: mentionNote.title, projectId: String(project._id), contentDoc: mentionDoc(users), version: mentionVersion, changeReason: 'update mentions' }, manager);
    const firstMention = await updateMentions([viewer]);
    assert.equal(firstMention.status, 200);
    mentionVersion = firstMention.data.version;
    const secondMention = await updateMentions([viewer]);
    assert.equal(secondMention.status, 200);
    mentionVersion = secondMention.data.version;
    await waitFor(() => Notification.countDocuments({ noteId: mentionNote.id, type: 'mentioned', userId: viewer._id }));
    const viewerMentionNotifications = await Notification.find({ noteId: mentionNote.id, type: 'mentioned', userId: viewer._id });
    assert.equal(viewerMentionNotifications.length, 1, 'saving an unchanged mention does not notify again');
    assert.equal(viewerMentionNotifications[0].actorName, manager.name, 'mention notification names the actual editor');
    const addedMention = await updateMentions([viewer, outsider]);
    assert.equal(addedMention.status, 200);
    await waitFor(() => Notification.countDocuments({ noteId: mentionNote.id, type: 'mentioned', userId: outsider._id }));
    assert.equal(await Notification.countDocuments({ noteId: mentionNote.id, type: 'mentioned', userId: outsider._id }), 1, 'only newly added mentions are notified');
    const managerComment = await call('POST', `/eln/${note.id}/comments`, { body: 'comment on owner note' }, manager);
    assert.equal(managerComment.status, 201);
    await waitFor(async () => (await Notification.countDocuments({ noteId: note.id })) >= 2);
    const managerNotifications = await call('GET', '/notifications?unread=true', undefined, manager);
    assert.equal(managerNotifications.status, 200, JSON.stringify(managerNotifications.data));
    assert.ok(managerNotifications.data.items.some((item) => item.type === 'mentioned'));
    const authorNotifications = await call('GET', '/notifications', undefined, author);
    assert.ok(authorNotifications.data.items.some((item) => item.type === 'commented'));
    const ownNotification = managerNotifications.data.items.find((item) => item.type === 'mentioned');
    assert.equal((await call('POST', `/notifications/${ownNotification._id}/read`, {}, author)).status, 404);
    assert.equal((await call('POST', `/notifications/${ownNotification._id}/read`, {}, manager)).status, 200);
    assert.equal((await call('PUT', `/comments/${comment.data._id}`, { body: 'edited by another' }, manager)).status, 403);
    assert.equal((await call('POST', `/comments/${comment.data._id}/resolve`, {}, manager)).status, 200);
    const outsiderComment = await call('POST', `/eln/${note.id}/comments`, { body: 'comment before membership removal' }, outsider);
    assert.equal(outsiderComment.status, 201);
    const originalMembers = project.members;
    project.members = originalMembers.filter((member) => String(member.userId) !== String(outsider._id));
    await project.save();
    assert.ok([403, 404].includes((await call('PUT', `/comments/${outsiderComment.data._id}`, { body: 'edit after removal' }, outsider)).status));
    assert.ok([403, 404].includes((await call('DELETE', `/comments/${outsiderComment.data._id}`, {}, outsider)).status));
    assert.ok([403, 404].includes((await call('POST', `/comments/${outsiderComment.data._id}/resolve`, {}, outsider)).status));
    project.members = originalMembers;
    await project.save();
    assert.equal((await call('POST', `/eln/${note.id}/presence`, {}, viewer)).status, 403);
    assert.equal((await call('POST', `/eln/${note.id}/presence`, {}, manager)).status, 200);
    assert.ok((await call('GET', `/eln/${note.id}`, undefined, author)).data.editors.some((item) => item.id === String(manager._id)));

    const pending = await createNote(author, { title: 'Review queue note', projectId: String(project._id) });
    await Note.updateOne({ _id: pending.data.id }, { $set: { status: '승인대기' } });
    assert.equal((await call('GET', '/eln/review-queue', undefined, manager)).data.total >= 1, true);
    assert.equal((await call('GET', '/eln/review-queue', undefined, author)).data.items.some((item) => item.id === pending.data.id), false);
    assert.equal((await call('GET', '/eln/review-queue', undefined, viewer)).data.items.some((item) => item.id === pending.data.id), false);
    const ownPending = await Note.create({ authorId: admin._id, author: admin.name, title: 'Admin own pending', projectId: project._id, status: '승인대기' });
    const adminQueue = (await call('GET', '/eln/review-queue', undefined, admin)).data.items;
    assert.equal(adminQueue.some((item) => item.id === pending.data.id), true);
    assert.equal(adminQueue.some((item) => item.id === String(ownPending._id)), false);

    const notificationProject = await Project.create({ name: 'Approval notification project', members: [
      { userId: author._id, name: author.name, role: 'editor' },
      { userId: manager._id, name: manager.name, role: 'manager' },
      { userId: viewer._id, name: viewer.name, role: 'manager' },
    ] });
    const notificationNote = await createNote(author, { projectId: String(notificationProject._id) });
    const requested = await call('POST', `/eln/${notificationNote.data.id}/request-approval`, { version: notificationNote.data.version, password: authorPass }, author);
    assert.equal(requested.status, 200);
    assert.equal(await Notification.countDocuments({ noteId: notificationNote.data.id, type: 'approval-requested', userId: author._id }), 0);
    assert.equal(await Notification.countDocuments({ noteId: notificationNote.data.id, type: 'approval-requested', userId: viewer._id }), 0);
    assert.equal(await Notification.countDocuments({ noteId: notificationNote.data.id, type: 'approval-requested', userId: manager._id }), 1);
  });

  await t.test('Search parity, membership removal, and paginated summary projection', async () => {
    const note = (await createNote(author, { title: 'Searchable unique zephyr', projectId: String(project._id) })).data;
    await indexNoteAfterCommit(await Note.findById(note.id));
    const authorResults = await call('GET', '/search?q=zephyr', undefined, author);
    assert.equal(authorResults.status, 200);
    assert.ok(authorResults.data.items.some((item) => item.id === note.id && item.title === note.title));
    assert.equal('content' in authorResults.data.items[0], false);
    const outsiderBefore = await call('GET', '/search?q=zephyr', undefined, outsider);
    assert.ok(outsiderBefore.data.items.some((item) => item.id === note.id));
    project.members = project.members.filter((member) => String(member.userId) !== String(outsider._id));
    await project.save();
    const outsiderAfter = await call('GET', '/search?q=zephyr', undefined, outsider);
    assert.equal(outsiderAfter.data.items.some((item) => item.id === note.id), false);
    for (let i = 0; i < 3; i++) await createNote(author, { title: `Paged ${i}`, projectId: String(project._id) });
    const page = await call('GET', `/eln?page=1&limit=2&projectId=${project._id}`, undefined, author);
    assert.equal(page.status, 200);
    assert.equal(page.data.items.length, 2);
    assert.ok(page.data.total >= 4);
    assert.equal('content' in page.data.items[0], false);
    assert.equal('contentDoc' in page.data.items[0], false);
    assert.equal('versions' in page.data.items[0], false);
    for (const field of ['protocolRun', 'requestId', 'requestHash', 'signatures', 'pendingAuthorSignature', 'reagentsUsed']) assert.equal(field in page.data.items[0], false);
    assert.equal((await call('GET', '/eln?page=1&limit=101', undefined, author)).status, 400);
    await searchIndex.health();
  });

  await t.test('Migration dry-run writes nothing; apply skips approval-locked and sealed notes', async () => {
    const candidate = await Note.create({ authorId: author._id, author: author.name, title: 'migrate candidate', content: '<p>convert me</p>', status: '진행중' });
    const waiting = await Note.create({ authorId: author._id, author: author.name, title: 'locked waiting', content: '<p>keep html</p>', status: '승인대기' });
    const approved = await Note.create({ authorId: author._id, author: author.name, title: 'locked approved', content: '<p>keep html</p>', status: '승인됨' });
    const sealed = await Note.create({ authorId: author._id, author: author.name, title: 'sealed', content: '<p>keep sealed html</p>', status: '반려' });
    const sealHash = crypto.randomBytes(32).toString('hex');
    const migrationPdfPath = path.join(dir, 'migration-fixture.pdf');
    const migrationPdf = Buffer.from('fixture PDF');
    await writeFile(migrationPdfPath, migrationPdf);
    await Seal.create({ verifyId: crypto.randomBytes(16).toString('base64url'), noteId: sealed._id, noteVersion: 1, manifest: { schemaVersion: 1 }, manifestSha256: crypto.randomBytes(32).toString('hex'), pdfPath: migrationPdfPath, pdfSha256: crypto.createHash('sha256').update(migrationPdf).digest('hex'), signatures: [], sealHash, timestamp: { provider: 'none', status: 'not_configured', attempts: 0 } });
    const cwd = fileURLToPath(new URL('../', import.meta.url));
    const childEnv = { ...process.env, MONGO_URI: repl.getUri(), DB_NAME: 'phase2', DATA_DIR: dir, NODE_ENV: 'test', JWT_SECRET: process.env.JWT_SECRET };
    const beforeVersions = await Version.countDocuments({ noteId: candidate._id });
    const dry = await execFile(process.execPath, ['scripts/migrate-notes-to-doc.js'], { cwd, env: childEnv });
    const dryReport = JSON.parse(dry.stdout);
    assert.equal(dryReport.mode, 'dry-run');
    assert.ok(dryReport.notes.find((item) => item.id === String(candidate._id)).warnings);
    assert.equal((await Note.findById(candidate._id)).contentFormat, 'html');
    assert.equal(await Version.countDocuments({ noteId: candidate._id }), beforeVersions);
    const applied = await execFile(process.execPath, ['scripts/migrate-notes-to-doc.js', '--apply'], { cwd, env: childEnv });
    assert.equal(JSON.parse(applied.stdout).mode, 'apply');
    const migrated = await Note.findById(candidate._id);
    assert.equal(migrated.contentFormat, 'doc');
    assert.ok(migrated.version > candidate.version);
    assert.equal(await Version.countDocuments({ noteId: candidate._id }), 1);
    assert.equal((await Note.findById(waiting._id)).contentFormat, 'html');
    assert.equal((await Note.findById(approved._id)).contentFormat, 'html');
    assert.equal((await Note.findById(sealed._id)).contentFormat, 'html');
  });

  await t.test('Invitation/reset mail links, enumeration, single-use tokens, and signing-key revocation', async () => {
    const invite = await call('POST', '/members', { name: 'invited-phase2', email: 'invited-phase2@example.test', role: 'researcher', invite: true }, admin);
    assert.equal(invite.status, 201);
    await waitFor(() => sent.some((message) => message.to === 'invited-phase2@example.test'));
    const inviteMail = sent.find((message) => message.to === 'invited-phase2@example.test');
    assert.ok(inviteMail);
    const inviteMatch = inviteMail.text.match(/https:\/\/labhub\.example\.test\/invite#([A-Za-z0-9_-]+)/);
    assert.ok(inviteMatch, `invitation email uses the URL fragment format; captured=${JSON.stringify(inviteMail)}`);
    const inspect = await call('POST', '/auth/invitation/inspect', { token: inviteMatch[1] });
    assert.deepEqual(inspect.data, { name: 'invited-phase2', email: 'invited-phase2@example.test' });
    const invalidInspect = await call('POST', '/auth/invitation/inspect', { token: 'bad-token' });
    assert.equal(invalidInspect.status, 400);
    assert.deepEqual(invalidInspect.data, { message: '초대 링크가 유효하지 않거나 만료되었습니다.' });
    const accepted = await call('POST', '/auth/invitation/accept', { token: inviteMatch[1], newPassword: pass });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.success, true);
    assert.equal(accepted.cookie, null, 'invitation acceptance does not auto-login');
    assert.equal((await call('POST', '/auth/invitation/inspect', { token: inviteMatch[1] })).status, 400);
    assert.equal((await call('POST', '/auth/invitation/accept', { token: inviteMatch[1], newPassword: pass })).status, 400);

    const resetRequest = async (email) => {
      return call('POST', '/auth/password-reset/request', { email });
    };
    const sentBefore = sent.length;
    const originalFindOne = User.findOne;
    const originalEmit = ServerResponse.prototype.emit;
    let resetResponseFinished = false;
    let lookupAfterResponse = null;
    ServerResponse.prototype.emit = function (event, ...args) {
      if (event === 'finish') resetResponseFinished = true;
      return originalEmit.call(this, event, ...args);
    };
    User.findOne = function (filter, ...args) {
      if (filter?.email === author.email) lookupAfterResponse = resetResponseFinished;
      return originalFindOne.call(this, filter, ...args);
    };
    let existingReset;
    try {
      existingReset = await resetRequest(author.email);
      await waitFor(() => lookupAfterResponse !== null);
    } finally {
      User.findOne = originalFindOne;
      ServerResponse.prototype.emit = originalEmit;
    }
    const missingReset = await resetRequest('missing-phase2@example.test');
    assert.equal(lookupAfterResponse, true, 'account lookup starts only after the reset response has finished');
    assert.equal(existingReset.status, 200);
    assert.equal(missingReset.status, 200);
    assert.deepEqual(existingReset.data, missingReset.data);
    await waitFor(() => sent.slice(sentBefore).some((message) => message.to === author.email));
    const resetMail = sent.slice(sentBefore).find((message) => message.to === author.email);
    assert.ok(resetMail);
    const resetMatch = resetMail.text.match(/https:\/\/labhub\.example\.test\/reset-password#([A-Za-z0-9_-]+)/);
    assert.ok(resetMatch, 'password reset email uses the URL fragment format');
    const activeKey = await SigningKey.create({ userId: author._id, keyId: 'phase2-reset-key', algorithm: 'Ed25519', publicKey: 'public', encryptedPrivateKey: 'cipher', active: true });
    const oldTokenVersion = author.tokenVersion;
    authorPass = 'New-phase2-password-2026';
    const confirmed = await call('POST', '/auth/password-reset/confirm', { token: resetMatch[1], newPassword: authorPass });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.cookie, null);
    const reloaded = await User.findById(author._id);
    assert.equal(reloaded.tokenVersion, oldTokenVersion + 1);
    author = reloaded;
    assert.equal((await SigningKey.findById(activeKey._id)).active, false);
    assert.equal((await call('POST', '/auth/password-reset/confirm', { token: resetMatch[1], newPassword: 'Another-phase2-password-2026' })).status, 400);
    const expired = await AccountToken.create({ userId: author._id, tokenHash: crypto.createHash('sha256').update('expired-token').digest('hex'), purpose: 'password-reset', expiresAt: new Date(Date.now() - 1000) });
    assert.ok(expired);
    assert.equal((await call('POST', '/auth/password-reset/confirm', { token: 'expired-token', newPassword: 'New-phase2-password-2026' })).status, 400);
    const inactive = await newUser('inactive-phase2', 'researcher');
    inactive.isActive = false; await inactive.save();
    const afterActiveMail = sent.length;
    assert.equal((await resetRequest(inactive.email)).status, 200);
    assert.equal(sent.length, afterActiveMail);
  });

  await t.test('Doc v2 seal, PDF renderer, public verification, and offline verify.mjs', async () => {
    const sealExperiment = await call('POST', `/projects/${project._id}/experiments`, { name: 'Seal attachment experiment' }, author);
    assert.equal(sealExperiment.status, 201);
    const noteResult = await createNote(author, { title: 'Korean v2 seal', projectId: String(project._id), experimentId: String(sealExperiment.data._id) });
    assert.equal(noteResult.status, 201);
    const png = PNG.sync.write({ width: 48, height: 32, data: Buffer.from(Array.from({ length: 48 * 32 * 4 }, (_, index) => index % 4 === 3 ? 180 : index % 4 === 0 ? 40 : 130)) });
    const imagePath = path.join(dir, 'phase2.png'); await writeFile(imagePath, png);
    const imageFile = await Attachment.create({ noteId: noteResult.data.id, filename: 'phase2.png', originalName: 'phase2.png', mimeType: 'image/png', size: png.length, path: imagePath, sha256: crypto.createHash('sha256').update(png).digest('hex'), uploadedBy: author._id });
    const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const richDoc = { type: 'doc', schemaVersion: SCHEMA_VERSION, content: [
      { type: 'heading', attrs: { level: 1, align: 'center' }, content: [{ type: 'text', text: '한글 제목' }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('검토 완료')] }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { rowspan: 2 }, content: [paragraph('시료')] }, { type: 'tableHeader', attrs: { colspan: 2 }, content: [paragraph('결과')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('양성')] }, { type: 'tableCell', content: [paragraph('확인')] }] },
      ] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'sample = 1 // 한글 주석' }] },
      { type: 'blockquote', content: [paragraph('기록된 관찰')] },
      { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
      { type: 'image', attrs: { attachmentId: String(imageFile._id), alt: 'phase2 image', width: 48 } },
    ] };
    const update = await call('PUT', `/eln/${noteResult.data.id}`, { title: noteResult.data.title, projectId: String(project._id), contentDoc: richDoc, version: noteResult.data.version, changeReason: 'rich doc for seal' }, author);
    assert.equal(update.status, 200);
    author = await User.findById(author._id);
    const requested = await call('POST', `/eln/${noteResult.data.id}/request-approval`, { version: update.data.version, password: authorPass }, author);
    assert.equal(requested.status, 200);
    const approved = await call('POST', `/eln/${noteResult.data.id}/approve`, { version: requested.data.version, password: pass }, admin);
    assert.equal(approved.status, 200);
    const seal = await Seal.findOne({ noteId: noteResult.data.id });
    if (process.env.PHASE2_PDF_OUTPUT) await writeFile(process.env.PHASE2_PDF_OUTPUT, await readStored(seal));
    assert.equal(seal.manifest.schemaVersion, 2);
    assert.equal(seal.manifest.contentFormat, 'doc');
    assert.equal(seal.manifest.contentDoc.type, 'doc');
    assert.ok(seal.manifest.attachments.some((item) => item.sha256 === imageFile.sha256));
    const amendment = await call('POST', `/eln/${noteResult.data.id}/amend`, { reason: 'preserve image and document fields' }, author);
    assert.equal(amendment.status, 201);
    assert.equal(amendment.data.contentFormat, 'doc');
    assert.deepEqual(amendment.data.contentDoc, update.data.contentDoc);
    assert.equal(amendment.data.experimentId, String(sealExperiment.data._id));
    const amendmentRead = await call('GET', `/eln/${amendment.data.id}`, undefined, author);
    assert.ok(amendmentRead.data.attachments.some((item) => String(item._id || item.id) === String(imageFile._id)));
    const unrelatedNote = (await createNote(author, { projectId: String(project._id) })).data;
    const unrelatedFilePath = path.join(dir, 'unrelated.png');
    await writeFile(unrelatedFilePath, png);
    const unrelatedFile = await Attachment.create({ noteId: unrelatedNote.id, filename: 'unrelated.png', originalName: 'unrelated.png', mimeType: 'image/png', size: png.length, path: unrelatedFilePath, sha256: crypto.createHash('sha256').update(png).digest('hex'), uploadedBy: author._id });
    const unrelatedDoc = { ...doc('unrelated'), content: [{ type: 'image', attrs: { attachmentId: String(unrelatedFile._id), alt: 'unrelated' } }] };
    assert.equal((await call('PUT', `/eln/${amendment.data.id}`, { title: amendment.data.title, projectId: String(project._id), contentDoc: unrelatedDoc, version: amendment.data.version, changeReason: 'reject unrelated attachment' }, author)).status, 400);
    const originalImageBytes = await readFile(imagePath);
    await writeFile(imagePath, Buffer.from('tampered attachment bytes'));
    const tamperedAncestorRequest = await call('POST', `/eln/${amendment.data.id}/request-approval`, { version: amendment.data.version, password: authorPass }, author);
    await writeFile(imagePath, originalImageBytes);
    assert.equal(tamperedAncestorRequest.status, 409, 'signing verifies the hash of an inherited attachment');
    const amendmentRequest = await call('POST', `/eln/${amendment.data.id}/request-approval`, { version: amendment.data.version, password: authorPass }, author);
    assert.equal(amendmentRequest.status, 200);
    assert.ok(amendmentRequest.data.pendingAuthorSignature.manifest.attachments.some((item) => item.sha256 === imageFile.sha256));
    const amendmentApproval = await call('POST', `/eln/${amendment.data.id}/approve`, { version: amendmentRequest.data.version, password: pass }, admin);
    assert.equal(amendmentApproval.status, 200);
    const amendmentSeal = await Seal.findOne({ noteId: amendment.data.id });
    assert.ok(amendmentSeal.manifest.attachments.some((item) => item.sha256 === imageFile.sha256));
    assert.match((await readStored(amendmentSeal)).toString('latin1'), /\/Subtype\s*\/Image/, 'amendment PDF renders the inherited image attachment');
    const nestedAmendment = await call('POST', `/eln/${amendment.data.id}/amend`, { reason: 'second correction retains ancestor image' }, author);
    assert.equal(nestedAmendment.status, 201);
    assert.deepEqual(nestedAmendment.data.contentDoc, update.data.contentDoc);
    const nestedApprovalRequest = await call('POST', `/eln/${nestedAmendment.data.id}/request-approval`, { version: nestedAmendment.data.version, password: authorPass }, author);
    assert.equal(nestedApprovalRequest.status, 200);
    assert.ok(nestedApprovalRequest.data.pendingAuthorSignature.manifest.attachments.some((item) => item.sha256 === imageFile.sha256));
    const nestedApproval = await call('POST', `/eln/${nestedAmendment.data.id}/approve`, { version: nestedApprovalRequest.data.version, password: pass }, admin);
    assert.equal(nestedApproval.status, 200);
    const nestedSeal = await Seal.findOne({ noteId: nestedAmendment.data.id });
    assert.ok(nestedSeal.manifest.attachments.some((item) => item.sha256 === imageFile.sha256));
    const verify = await call('GET', `/public/verify/${seal.verifyId}`);
    assert.equal(verify.status, 200);
    assert.equal(verify.data.sealHash, seal.sealHash);
    assert.equal(Object.keys(verify.data).sort().join(','), 'algorithm,pdfSha256,sealHash,sealedAt,timestamp,valid');
    const bundle = await fetch(base + `/eln/${noteResult.data.id}/seal/bundle`, { headers: { Cookie: `labhub_session=${token(author)}` } });
    assert.equal(bundle.status, 200);
    const entries = unzipSync(Buffer.from(await bundle.arrayBuffer()));
    const bundleDir = path.join(dir, 'v2-evidence'); await mkdir(bundleDir);
    for (const [name, contents] of Object.entries(entries)) await writeFile(path.join(bundleDir, name), contents);
    await execFile(process.execPath, ['verify.mjs'], { cwd: bundleDir });
  });

  await t.test('Backup and restore include Phase 2 collections', async () => {
    const presenceNote = await Note.findOne({ contentFormat: 'doc' });
    await Presence.findOneAndUpdate({ noteId: presenceNote._id, userId: admin._id }, { $set: { name: admin.name, expiresAt: new Date(Date.now() + 5 * 60 * 1000) } }, { upsert: true });
    const destination = path.join(dir, 'phase2-backup');
    const backupResult = await backup(destination);
    assert.ok(backupResult.collections >= 24);
    const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, 4);
    const raw = await readFile(path.join(destination, 'records.json'), 'utf8');
    for (const collection of ['experiments', 'protocols', 'protocolversions', 'comments', 'notifications', 'notepresences', 'accounttokens']) assert.match(raw, new RegExp(`"${collection}"`));
    await mongoose.connection.dropDatabase();
    const restored = await restore(destination);
    assert.equal(restored.collections, backupResult.collections);
    assert.ok(await Experiment.countDocuments());
    assert.ok(await Protocol.countDocuments());
    assert.ok(await ProtocolVersion.countDocuments());
    assert.ok(await Comment.countDocuments());
    assert.ok(await Notification.countDocuments());
    assert.ok(await AccountToken.countDocuments());
    assert.ok(await Presence.countDocuments());
  });
});
