import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'labhub-phase4-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'phase4-test-secret-with-at-least-32-characters';
process.env.AI_PROVIDER = 'none';
process.env.AI_RATE_LIMIT = '100';
process.env.STORAGE_PROVIDER = 'local';
process.env.SEARCH_PROVIDER = 'memory';
process.env.ALLOW_LEGACY_ELN_WRITES = 'true';
delete process.env.ANTHROPIC_API_KEY;

const { app } = await import('../app.js');
const { AiError, computeSha256 } = await import('@labhub/ai-core');
const { setAiClientForTests, getAiCore, aiStatus, initializeAi } = await import('../lib/ai.js');
const User = (await import('../models/User.js')).default;
const Project = (await import('../models/Project.js')).default;
const ElnNote = (await import('../models/ElnNote.js')).default;
const AiRun = (await import('../models/AiRun.js')).default;
const FileAttachment = (await import('../models/FileAttachment.js')).default;
const AuditLog = (await import('../models/AuditLog.js')).default;
const { searchIndex, ensureSearchIndex } = await import('../lib/search.js');
const { put } = await import('../lib/storage/index.js');
const { createManifest } = await import('../lib/seal/manifest.js');
const { createSealPdf } = await import('../lib/seal/pdf.js');
const { backup } = await import('../lib/backup.js');
const { jwtSecret } = await import('../config.js');

const calls = [];
let responseOverride;
function fakeResponse(body) {
  if (responseOverride !== undefined) {
    const response = responseOverride;
    responseOverride = undefined;
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response(body) : response;
  }
  const schema = body.output_config?.format?.schema;
  let json;
  let content;
  if (schema?.properties?.sections) {
    json = { sections: [{ heading: '관찰', blocks: [{ kind: 'paragraph', text: 'AI 제안 본문' }] }], missing: ['실험 조건'] };
  } else if (schema?.properties?.steps) {
    json = { title: '가짜 프로토콜', steps: [], safetyNotes: ['보호 장비 확인'] };
  } else if (schema?.properties?.tables) {
    json = { tables: [{ title: '측정값', header: ['시료', '값'], rows: [['A1', '1.2']] }] };
  } else if (schema?.properties?.findings) {
    json = { findings: [{ severity: 'warning', category: 'missing_condition', message: '조건을 확인해주세요.', blockIndex: 0 }] };
  }
  if (json) content = [{ type: 'text', text: JSON.stringify(json) }];
  else content = [{ type: 'text', text: '가짜 AI 답변입니다.', citations: [{ document_index: 0, cited_text: 'Mongo 인용 문장' }] }];
  return { id: `fake-${calls.length}`, model: 'fake-model', stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 }, content };
}
const fakeClient = {
  beta: {
    messages: {
      stream(body) {
        calls.push({ body });
        return { finalMessage: async () => fakeResponse(body) };
      },
    },
  },
};

const repl = await MongoMemoryReplSet.create({
  binary: { downloadDir: path.resolve('node_modules/.cache/mongodb-memory-server') },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
await mongoose.connect(repl.getUri(), { dbName: 'phase4' });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const api = `http://127.0.0.1:${server.address().port}/api`;
const password = 'Phase4-test-password-2026';
const tokenFor = (user) => jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion || 0, scope: 'session' }, jwtSecret, { algorithm: 'HS256', expiresIn: '12h' });
const cookieFor = (user) => `labhub_session=${tokenFor(user)}`;
async function createUser(name, role = 'researcher') {
  return User.create({ name, email: `${name}@phase4.test`, password: await bcrypt.hash(password, 4), role });
}
async function call(method, pathname, body, user, { csrf = true } = {}) {
  const response = await fetch(api + pathname, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(user ? { Cookie: cookieFor(user) } : {}),
      ...(csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'X-LabHub-Request': '1' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data, headers: response.headers };
}
async function createNote(user, values = {}) {
  return ElnNote.create({ title: 'Phase 4 note', authorId: user._id, author: user.name, content: '<p>stored note content</p>', ...values });
}

await test('Phase 4 AI backend contract and regression coverage', async (t) => {
  const editor = await createUser('editor4');
  const viewer = await createUser('viewer4', 'viewer');
  const projectReader = await createUser('projectreader4');
  const outsider = await createUser('outsider4');
  const removedMember = await createUser('removed4');
  const project = await Project.create({ name: 'AI project', members: [
    { userId: editor._id, name: editor.name, role: 'editor' },
    { userId: viewer._id, name: viewer.name, role: 'viewer' },
    { userId: projectReader._id, name: projectReader.name, role: 'viewer' },
    { userId: removedMember._id, name: removedMember.name, role: 'editor' },
  ] });
  const projectNote = await createNote(editor, { projectId: project._id, content: '<p>ACTUAL_MONGO_PASSAGE_MARKER: 배양 결과는 37도였습니다.</p>' });
  const foreignNote = await createNote(outsider, { content: '<p>FOREIGN_NOTE_SECRET_MARKER</p>' });
  setAiClientForTests(fakeClient);
  process.env.AI_PROVIDER = 'anthropic';
  process.env.AI_MODEL = 'fake-model';

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await repl.stop();
    if (path.dirname(dataDir) === path.resolve(os.tmpdir()) && path.basename(dataDir).startsWith('labhub-phase4-')) await rm(dataDir, { recursive: true, force: true });
  });

  await t.test('AI disabled by default returns 503 without touching the fake provider or retrieval', async () => {
    process.env.AI_PROVIDER = 'none';
    const callCount = calls.length;
    const originalSearch = searchIndex.search;
    let retrievalCalls = 0;
    searchIndex.search = async (...args) => { retrievalCalls++; return originalSearch.apply(searchIndex, args); };
    try {
      assert.equal((await call('GET', '/ai/status', undefined, editor)).status, 200);
      assert.deepEqual((await call('GET', '/ai/status', undefined, editor)).data, { enabled: false, features: [] });
      assert.equal((await call('POST', '/ai/draft-note', { memo: 'memo' }, editor)).status, 503);
      assert.equal((await call('POST', '/ai/generate-protocol', { instruction: 'instruction' }, editor)).status, 503);
      assert.equal((await call('POST', '/ai/extract-tables', { text: 'table' }, editor)).status, 503);
      assert.equal((await call('POST', '/ai/check-note', { noteId: String(projectNote._id) }, editor)).status, 503);
      assert.equal((await call('POST', '/ai/ask', { question: 'question' }, editor)).status, 503);
      assert.equal(calls.length, callCount);
      assert.equal(retrievalCalls, 0);
      assert.equal((await call('POST', '/ai/draft-note', { memo: 'memo' }, editor, { csrf: false })).status, 403);
      assert.equal((await call('GET', '/ai/status', undefined, null)).status, 401);
    } finally {
      searchIndex.search = originalSearch;
      process.env.AI_PROVIDER = 'anthropic';
    }
  });

  await t.test('Missing Anthropic key disables AI and logs one safe startup warning', () => {
    setAiClientForTests(null);
    process.env.AI_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    const oldWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      assert.deepEqual(initializeAi(), { enabled: false, rateLimit: 100 });
      assert.deepEqual(initializeAi(), { enabled: false, rateLimit: 100 });
      assert.equal(getAiCore(), null);
      assert.deepEqual(aiStatus(), { enabled: false, features: [] });
      assert.equal(warnings.length, 1);
      assert.doesNotMatch(warnings[0], /key value|secret/i);
    } finally {
      console.warn = oldWarn;
      setAiClientForTests(fakeClient);
      process.env.AI_PROVIDER = 'anthropic';
    }
  });

  await t.test('Status exposes features only, write features reject viewers, and checks enforce note read access', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-only-fake-key';
    const status = await call('GET', '/ai/status', undefined, editor);
    assert.deepEqual(status.data, { enabled: true, features: ['draftNote', 'generateProtocol', 'extractTables', 'checkNote', 'askNotes'] });
    assert.equal(JSON.stringify(status.data).includes('fake-model'), false);
    assert.equal((await call('POST', '/ai/draft-note', { memo: 'viewer memo' }, viewer)).status, 403);
    assert.equal((await call('POST', '/ai/generate-protocol', { instruction: 'viewer protocol' }, viewer)).status, 403);
    assert.equal((await call('POST', '/ai/extract-tables', { text: 'viewer table' }, viewer)).status, 403);
    assert.equal((await call('PUT', `/eln/${projectNote._id}`, { title: 'viewer cannot change', version: 1, changeReason: 'permission test' }, projectReader)).status, 403);
    const check = await call('POST', '/ai/check-note', { noteId: String(projectNote._id) }, projectReader);
    assert.equal(check.status, 200);
    assert.equal(check.data.result.findings[0].blockIndex, 0);
    const before = calls.length;
    assert.equal((await call('POST', '/ai/check-note', { noteId: String(foreignNote._id) }, editor)).status, 404);
    assert.equal(calls.length, before);
  });

  await t.test('Draft results persist provenance only and can be linked once to a note', async () => {
    const memo = 'PRIVATE_DRAFT_MEMO_MARKER';
    const response = await call('POST', '/ai/draft-note', { memo, sections: ['관찰'] }, editor);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.data).sort(), ['result', 'runId']);
    const run = await AiRun.findById(response.data.runId).lean();
    assert.equal(String(run.userId), String(editor._id));
    assert.equal(run.feature, 'draftNote');
    assert.equal(run.provenance.inputSha256.length, 64);
    assert.equal(run.provenance.outputSha256.length, 64);
    assert.equal(JSON.stringify(run).includes(memo), false);
    assert.equal(JSON.stringify(run).includes('AI 제안 본문'), false);
    const audit = await AuditLog.findOne({ action: 'AI_USE', targetType: 'AI_RUN', targetId: String(run._id) }).lean();
    assert.ok(audit);
    assert.deepEqual(Object.keys(audit.newState).sort(), ['createdAt', 'feature', 'inputSha256', 'model', 'outputSha256', 'provider', 'requestId', 'sourceIds', 'usage']);
    assert.equal(JSON.stringify(audit).includes(memo), false);
    assert.equal(JSON.stringify(audit).includes('AI 제안 본문'), false);

    const backupPath = path.join(dataDir, 'ai-run-backup');
    await backup(backupPath);
    const backupRecords = JSON.parse(await readFile(path.join(backupPath, 'records.json'), 'utf8'));
    assert.ok(backupRecords.airuns.some((record) => record._id?.$oid === String(run._id)));

    const created = await call('POST', '/eln', { title: 'AI draft note', content: '<p>reviewed and saved</p>', aiRunIds: [String(run._id), String(run._id)] }, editor);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.aiRuns.length, 1);
    assert.equal(created.data.aiRuns[0].runId, String(run._id));
    assert.equal(created.data.aiRuns[0].feature, 'draftNote');
    const updated = await call('PUT', `/eln/${created.data.id}`, { title: 'AI draft note updated', version: 1, changeReason: 'AI provenance link regression', aiRunIds: [String(run._id), String(run._id)] }, editor);
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.aiRuns.length, 1);

    const checkRun = await call('POST', '/ai/check-note', { noteId: String(projectNote._id) }, editor);
    assert.equal(checkRun.status, 200);
    const wrongFeature = await call('POST', '/eln', { title: 'Wrong AI feature', content: '<p>content</p>', aiRunIds: [checkRun.data.runId] }, editor);
    assert.equal(wrongFeature.status, 400);
    const foreignRun = await call('POST', '/ai/draft-note', { memo: 'outsider memo' }, outsider);
    const foreignLink = await call('POST', '/eln', { title: 'Foreign run', content: '<p>content</p>', aiRunIds: [foreignRun.data.runId] }, editor);
    assert.equal(foreignLink.status, 400);
    assert.equal((await call('POST', '/eln', { title: 'Invalid AI run', content: '<p>content</p>', aiRunIds: ['not-an-object-id'] }, editor)).status, 400);
  });

  await t.test('Table extraction reads only permitted PNG, JPEG, or PDF attachments', async () => {
    const bytes = Buffer.from('phase4 fake PNG image bytes');
    const storageKey = await put(Readable.from(bytes), { key: `ai-test/${crypto.randomUUID()}.png`, contentType: 'image/png' });
    const [attachment] = await FileAttachment.create([{
      filename: 'table.png', originalName: 'table.png', mimeType: 'image/png', size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), storageKey, noteId: projectNote._id, uploadedBy: editor._id,
    }]);
    const result = await call('POST', '/ai/extract-tables', { attachmentId: String(attachment._id) }, editor);
    assert.equal(result.status, 200);
    const imageContent = calls.at(-1).body.messages[0].content[0];
    assert.equal(imageContent.type, 'image');
    assert.equal(imageContent.source.media_type, 'image/png');
    assert.equal(Buffer.from(imageContent.source.data, 'base64').toString(), bytes.toString());
    const run = await AiRun.findById(result.data.runId).lean();
    assert.deepEqual(run.sourceIds, [String(attachment._id)]);

    const [unsupported] = await FileAttachment.create([{
      filename: 'unknown.bin', originalName: 'unknown.bin', mimeType: 'application/octet-stream', size: 1,
      storageKey: `ai-test/${crypto.randomUUID()}.bin`, noteId: projectNote._id, uploadedBy: editor._id,
    }]);
    const callsBefore = calls.length;
    assert.equal((await call('POST', '/ai/extract-tables', { attachmentId: String(unsupported._id) }, editor)).status, 400);
    assert.equal(calls.length, callsBefore);
    const [foreignAttachment] = await FileAttachment.create([{
      filename: 'foreign.pdf', originalName: 'foreign.pdf', mimeType: 'application/pdf', size: 1,
      storageKey: `ai-test/${crypto.randomUUID()}.pdf`, noteId: foreignNote._id, uploadedBy: outsider._id,
    }]);
    assert.equal((await call('POST', '/ai/extract-tables', { attachmentId: String(foreignAttachment._id) }, editor)).status, 404);
    assert.equal(calls.length, callsBefore);
  });

  await t.test('Ask passes MongoDB note text, ignores stale index text, and drops notes after project access is removed', async () => {
    await ensureSearchIndex();
    const originalSearch = searchIndex.search;
    try {
      searchIndex.search = async () => ({ items: [{ id: String(projectNote._id), snippet: 'STALE_INDEX_POISON_MARKER' }], total: 1, page: 1, limit: 5 });
      const answer = await call('POST', '/ai/ask', { question: 'What was the result?', limit: 5 }, viewer);
      assert.equal(answer.status, 200);
      assert.equal(answer.data.result.citations[0].noteId, String(projectNote._id));
      const passageBlocks = calls.at(-1).body.messages[0].content.filter((block) => block.type === 'document');
      assert.equal(passageBlocks.length, 1);
      assert.match(passageBlocks[0].source.data, /ACTUAL_MONGO_PASSAGE_MARKER/);
      assert.doesNotMatch(passageBlocks[0].source.data, /STALE_INDEX_POISON_MARKER/);

      responseOverride = { id: 'bad-citation', model: 'fake-model', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: '안전한 답변', citations: [{ document_index: 99, cited_text: '비공개 인용 텍스트' }] }] };
      const warningResult = await call('POST', '/ai/ask', { question: '질문' }, viewer);
      assert.equal(warningResult.status, 200);
      assert.deepEqual(warningResult.data.result.warnings, ['일부 인용을 원본 노트에 연결하지 못했습니다.']);
      const warningRun = await AiRun.findById(warningResult.data.runId).lean();
      assert.equal(warningRun.provenance.outputSha256, computeSha256(warningResult.data.result));

      const removedNote = await createNote(removedMember, { projectId: project._id, content: '<p>REMOVED_MEMBER_SECRET_MARKER</p>' });
      await Project.updateOne({ _id: project._id }, { $pull: { members: { userId: removedMember._id } } });
      const callsBefore = calls.length;
      searchIndex.search = async () => ({ items: [{ id: String(removedNote._id), snippet: 'STALE_INDEX_REMOVED_SECRET' }], total: 1, page: 1, limit: 5 });
      const denied = await call('POST', '/ai/ask', { question: 'What is in the old note?' }, removedMember);
      assert.equal(denied.status, 200);
      assert.deepEqual(denied.data.result.citations, []);
      assert.equal(calls.length, callsBefore);
    } finally {
      searchIndex.search = originalSearch;
    }
  });

  await t.test('AI errors map to stable Korean statuses without exposing prompts or provider text', async () => {
    const before = calls.length;
    const oversized = await call('POST', '/ai/draft-note', { memo: 'x'.repeat(100_001) }, editor);
    assert.equal(oversized.status, 413);
    assert.equal(calls.length, before);
    assert.equal((await call('POST', '/ai/draft-note', { memo: 12 }, editor)).status, 400);

    responseOverride = new AiError('PROVIDER_PRIVATE_RATE_LIMIT', { code: 'rate_limit' });
    const providerLimited = await call('POST', '/ai/draft-note', { memo: 'safe memo' }, editor);
    assert.equal(providerLimited.status, 429);
    assert.doesNotMatch(JSON.stringify(providerLimited.data), /PROVIDER_PRIVATE_RATE_LIMIT/);

    responseOverride = { id: 'refusal', stop_reason: 'refusal', stop_details: { explanation: 'PROVIDER_PRIVATE_REFUSAL' }, content: [{ type: 'text', text: 'PROVIDER_PRIVATE_REFUSAL' }] };
    const refused = await call('POST', '/ai/draft-note', { memo: 'safe memo' }, editor);
    assert.equal(refused.status, 422);
    assert.doesNotMatch(JSON.stringify(refused.data), /PROVIDER_PRIVATE_REFUSAL/);

    responseOverride = new Error('PROVIDER_PRIVATE_FAILURE_MARKER');
    const failed = await call('POST', '/ai/generate-protocol', { instruction: 'safe protocol' }, editor);
    assert.equal(failed.status, 502);
    assert.doesNotMatch(JSON.stringify(failed.data), /PROVIDER_PRIVATE_FAILURE_MARKER/);
  });

  await t.test('AI rate limit is applied per authenticated user', async () => {
    const limited = await createUser('limited4');
    process.env.AI_RATE_LIMIT = '1';
    try {
      assert.equal((await call('GET', '/ai/status', undefined, limited)).status, 200);
      const blocked = await call('POST', '/ai/draft-note', { memo: 'one request' }, limited);
      assert.equal(blocked.status, 429);
      assert.match(blocked.data.message, /AI 요청이 너무 많습니다/);
    } finally {
      process.env.AI_RATE_LIMIT = '100';
    }
  });

  await t.test('New manifests and PDFs include AI provenance lines only when runs exist', async () => {
    const note = await createNote(editor, { aiRuns: [] });
    const noRuns = await createManifest(note, []);
    assert.deepEqual(noRuns.manifest.aiRuns, []);
    const withRunsNote = { ...note.toObject(), aiRuns: [{
      runId: 'run-test-1', feature: 'draftNote', model: 'fake-model', outputSha256: 'a'.repeat(64), createdAt: new Date('2026-11-08T00:00:00.000Z'),
    }] };
    const withRuns = await createManifest(withRunsNote, []);
    assert.deepEqual(withRuns.manifest.aiRuns, [{
      runId: 'run-test-1', feature: 'draftNote', model: 'fake-model', outputSha256: 'a'.repeat(64), createdAt: '2026-11-08T00:00:00.000Z',
    }]);

    const originalText = PDFDocument.prototype.text;
    const printed = [];
    PDFDocument.prototype.text = function (...args) { if (typeof args[0] === 'string') printed.push(args[0]); return originalText.apply(this, args); };
    let noRunPdf;
    let withRunPdf;
    try {
      noRunPdf = await createSealPdf({ noteId: note._id, version: 1, manifest: noRuns.manifest, manifestSha256: noRuns.manifestSha256, signatures: [], verifyUrl: 'https://example.test/verify/no-ai' });
      assert.equal(printed.includes('AI 보조 사용'), false);
      printed.length = 0;
      withRunPdf = await createSealPdf({ noteId: note._id, version: 1, manifest: withRuns.manifest, manifestSha256: withRuns.manifestSha256, signatures: [], verifyUrl: 'https://example.test/verify/with-ai' });
      assert.equal(printed.filter((text) => text === 'AI 보조 사용').length, 1);
    } finally {
      PDFDocument.prototype.text = originalText;
      await Promise.all([noRunPdf, withRunPdf].filter(Boolean).map((filename) => unlink(filename).catch(() => {})));
    }
  });
});
