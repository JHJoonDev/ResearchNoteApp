import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const dir = await mkdtemp(path.join(os.tmpdir(), 'labhub-persist-'));
process.env.NODE_ENV = 'test';
process.env.ALLOW_LEGACY_ELN_WRITES = 'true';
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = 'persistence-test-only-long-secret-123456';
delete process.env.MONGO_URI;
delete process.env.TRUST_PROXY;
const probe = net.createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
process.env.LOCAL_DB_PORT = String(probe.address().port);
await new Promise((r) => probe.close(r));
const { connectDB } = await import('../database.js');
const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backendRoot = path.join(projectRoot, 'backend');
const { uploadDir, sealDir } = await import('../config.js');
const { backup, restore } = await import('../lib/backup.js');
const { openFile } = await import('../lib/storage/index.js');
async function readStored(record) { const chunks = []; for await (const chunk of await openFile(record)) chunks.push(chunk); return Buffer.concat(chunks); }
const { app } = await import('../app.js');
const NoteSeal = (await import('../models/NoteSeal.js')).default;
const { verifySeal } = await import('../lib/seal/verify.js');
await test('로컬 재시작 보존 및 첨부 포함 백업·복원', async (t) => {
  let close;
  let server;
  let restoreDir;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (close) await close();
    if (restoreDir && path.dirname(restoreDir) === path.resolve(os.tmpdir()) && path.basename(restoreDir).startsWith('labhub-restore-target-'))
      await rm(restoreDir, { recursive: true, force: true });
    if (
      path.dirname(dir) === path.resolve(os.tmpdir()) &&
      path.basename(dir).startsWith('labhub-persist-')
    )
      await rm(dir, { recursive: true, force: true });
  });
  close = await connectDB();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (route, method = 'GET', body, token) => {
    const response = await fetch(apiBase + route, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'X-LabHub-Request': '1' } : {}),
        ...(token ? { Cookie: `labhub_session=${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  const password = 'Persist-passphrase-2026';
  assert.equal((await call('/auth/setup', 'POST', { name: 'Persist Admin', email: 'persist-admin@example.test', password })).status, 201);
  const adminLogin = await call('/auth/login', 'POST', { email: 'persist-admin@example.test', password });
  const adminToken = /labhub_session=([^;]+)/.exec(adminLogin.cookie)[1];
  assert.equal((await call('/members', 'POST', { name: 'Persist Author', email: 'persist-author@example.test', password, role: 'researcher' }, adminToken)).status, 201);
  const authorLogin = await call('/auth/login', 'POST', { email: 'persist-author@example.test', password });
  const authorToken = /labhub_session=([^;]+)/.exec(authorLogin.cookie)[1];
  let approvedNote = (await call('/eln', 'POST', { title: 'Persisted approved note', content: '<p>Real signed evidence</p>' }, authorToken)).data;
  approvedNote = (await call(`/eln/${approvedNote.id}/request-approval`, 'POST', { version: approvedNote.version, password }, authorToken)).data;
  const approval = await call(`/eln/${approvedNote.id}/approve`, 'POST', { version: approvedNote.version, password }, adminToken);
  assert.equal(approval.status, 200);
  assert.equal(approval.data.status, '승인됨');
  const approvedSeal = await NoteSeal.findOne({ noteId: approvedNote.id });
  assert.ok(approvedSeal);
  assert.equal((await verifySeal(approvedSeal)).valid, true);
  const approvedSealId = String(approvedSeal._id);
  await new Promise((resolve) => server.close(resolve));
  server = null;
  const id = new mongoose.Types.ObjectId();
  await mongoose.connection.db
    .collection('elnnotes')
    .insertOne({ _id: id, title: '재시작 후 보존', version: 1 });
  const fileId = new mongoose.Types.ObjectId(),
    file = path.join(uploadDir, 'fixture');
  await writeFile(file, '원본 데이터');
  await mongoose.connection.db
    .collection('fileattachments')
    .insertOne({ _id: fileId, noteId: id, path: file, originalName: '결과.txt' });
  const sealId = new mongoose.Types.ObjectId();
  const pdfPath = path.join(sealDir, 'sealed-fixture.pdf');
  await writeFile(pdfPath, 'sealed PDF fixture');
  await mongoose.connection.db.collection('noteseals').insertOne({
    _id: sealId, noteId: id, noteVersion: 1, manifest: { title: 'sealed' }, manifestSha256: 'a'.repeat(64),
    pdfPath, pdfSha256: '15d6ef238c341326d48bf7448a0a0bfe12abfc6c586ffe26623f0a0f268d3e86', sealHash: 'b'.repeat(64),
    signatures: [], timestamp: { provider: 'none', status: 'not_configured' }, createdAt: new Date(), verifyId: 'persistence-fixture',
  });
  await mongoose.connection.db.collection('usersigningkeys').insertOne({ userId: new mongoose.Types.ObjectId(), keyId: 'backup-key' });
  await close();
  close = null;
  close = await connectDB();
  assert.equal(
    (await mongoose.connection.db.collection('elnnotes').findOne({ _id: id })).title,
    '재시작 후 보존',
  );
  const destination = path.join(dir, 'backup');
  await backup(destination);
  restoreDir = await mkdtemp(path.join(os.tmpdir(), 'labhub-restore-target-'));
  const restoreScript = `
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const repl = await MongoMemoryReplSet.create({ binary: { downloadDir: process.env.MONGOMS_DOWNLOAD_DIR }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
try {
  await mongoose.connect(repl.getUri(), { dbName: 'restored-new-dir' });
  const { restore } = await import('./lib/backup.js');
  const NoteSeal = (await import('./models/NoteSeal.js')).default;
  const { verifySeal } = await import('./lib/seal/verify.js');
  await restore(process.env.RESTORE_SOURCE);
  const seal = await NoteSeal.findById(process.env.RESTORE_SEAL_ID);
  if (!seal) throw new Error('Approved seal missing after restore');
  const result = await verifySeal(seal);
  if (!result.valid) throw new Error(JSON.stringify(result));
   console.log(JSON.stringify({ valid: result.valid, storageKey: seal.storageKey }));
} finally {
  await mongoose.disconnect();
  await repl.stop();
}`;
  const restoredRun = await execFile(process.execPath, ['--input-type=module', '-e', restoreScript], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: restoreDir,
      JWT_SECRET: 'restore-child-test-secret-long-enough-123456',
      RESTORE_SOURCE: destination,
      RESTORE_SEAL_ID: approvedSealId,
      MONGOMS_DOWNLOAD_DIR: path.join(backendRoot, 'node_modules', '.cache', 'mongodb-memory-server'),
    },
  });
  const restoredSummary = restoredRun.stdout.split(/\r?\n/).find((line) => line.startsWith('{') && line.includes('"valid"'));
  assert.ok(restoredSummary);
  const restoredInfo = JSON.parse(restoredSummary);
  assert.equal(restoredInfo.valid, true);
  assert.match(restoredInfo.storageKey, /^seals\//);
  await assert.rejects(() => restore(destination), /빈 데이터베이스/);
  // The target is an isolated test database; never drop an existing user database.
  assert.equal(mongoose.connection.name, 'labhub');
  const uri = mongoose.connection.client.options.hosts[0].toString();
  await mongoose.disconnect();
  await mongoose.connect(`mongodb://${uri}/?replicaSet=labhub`, { dbName: 'restored-test' });
  await restore(destination);
  assert.equal(
    (await mongoose.connection.db.collection('elnnotes').findOne({ _id: id })).title,
    '재시작 후 보존',
  );
  const restored = await mongoose.connection.db
    .collection('fileattachments')
    .findOne({ _id: fileId });
  assert.equal((await readStored(restored)).toString('utf8'), '원본 데이터');
  const restoredSeal = await mongoose.connection.db.collection('noteseals').findOne({ _id: sealId });
  assert.equal((await readStored(restoredSeal)).toString('utf8'), 'sealed PDF fixture');
  assert.equal(await mongoose.connection.db.collection('usersigningkeys').countDocuments({ keyId: 'backup-key' }), 1);
  await writeFile(path.join(destination, 'records.json'), 'corrupt');
  await assert.rejects(() => restore(destination), /손상된 백업/);
});
