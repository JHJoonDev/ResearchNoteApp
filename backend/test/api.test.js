import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { unzipSync } from 'fflate';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { Readable } from 'node:stream';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const dir = await mkdtemp(path.join(os.tmpdir(), 'labhub-test-'));
process.env.NODE_ENV = 'test';
process.env.ALLOW_LEGACY_ELN_WRITES = 'true';
process.env.DATA_DIR = dir;
process.env.JWT_SECRET = 'test-only-not-a-deployment-secret-123456';
delete process.env.TRUST_PROXY;
const execFile = promisify(execFileCallback);
const { app, parseTrustProxyHops } = await import('../app.js');
const { jwtSecret } = await import('../config.js');
const User = (await import('../models/User.js')).default;
const Note = (await import('../models/ElnNote.js')).default;
const Item = (await import('../models/LimsItem.js')).default;
const Audit = (await import('../models/AuditLog.js')).default;
const Version = (await import('../models/ElnVersion.js')).default;
const Attachment = (await import('../models/FileAttachment.js')).default;
const Seal = (await import('../models/NoteSeal.js')).default;
const SigningKey = (await import('../models/UserSigningKey.js')).default;
const Anchor = (await import('../models/AuditAnchor.js')).default;
const { canonicalize, sha256 } = await import('../lib/canonical.js');
const { openFile, put: putStored, remove: removeStored } = await import('../lib/storage/index.js');
const { generateTotp, decryptSigningKey } = await import('../lib/crypto.js');
const { verifySignature, FailureWindow } = await import('../lib/signing/index.js');
const { getTimestampProvider, verifyCms } = await import('../lib/timestamp/index.js');
const { processSealTimestamp, processPendingTimestamps, createAuditAnchor } = await import('../lib/seal/worker.js');
const { runBackground } = await import('../lib/background.js');
const { startFakeTsa } = await import('./helpers/fake-tsa.js');
const pass = 'Testing-passphrase-2026';
let mongo, server, base, admin, researcher, viewer, other, reviewer;
async function request(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Cookie: `labhub_session=${token}` } : {}),
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'X-LabHub-Request': '1' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie') };
}
const login = async (email) => {
  const result = await request('POST', '/auth/login', { email, password: pass });
  const token = /labhub_session=([^;]+)/.exec(result.cookie || '')?.[1];
  return { ...result.data, token };
};
async function makeUser(name, role) {
  const r = await request(
    'POST',
    '/members',
    { name, email: `${name}@example.test`, password: pass, role },
    admin.token,
  );
  assert.equal(r.status, 201);
  return login(`${name}@example.test`);
}
const createNote = (token, extra = {}) =>
  request('POST', '/eln', { title: '실험 노트', content: '<p>관찰 결과</p>', ...extra }, token);
const createItem = (stock = 10) =>
  request('POST', '/lims', { name: '시약', stockValue: stock, unit: 'mL' }, admin.token);
async function readStored(record) { const chunks = []; for await (const chunk of await openFile(record)) chunks.push(chunk); return Buffer.concat(chunks); }
async function replaceStored(record, bytes) { await removeStored(record.storageKey); await putStored(Readable.from(bytes), { key: record.storageKey, contentType: record.mimeType || 'application/pdf' }); }
await test('JCS 정규화 고정 벡터', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalize({ numbers: [4.5, 0.002, 1e30], value: -0 }), '{"numbers":[4.5,0.002,1e+30],"value":0}');
  assert.equal(sha256('{"a":1,"b":2}'), crypto.createHash('sha256').update('{"a":1,"b":2}').digest('hex'));
  assert.throws(() => canonicalize({ value: undefined }));
});
await test('TRUST_PROXY는 비음수 홉 수만 허용', () => {
  assert.equal(parseTrustProxyHops(undefined), undefined);
  assert.equal(parseTrustProxyHops('0'), 0);
  assert.equal(parseTrustProxyHops('2'), 2);
  assert.throws(() => parseTrustProxyHops('true'), /정수 홉 수/);
  assert.throws(() => parseTrustProxyHops('-1'), /정수 홉 수/);
  assert.equal(app.get('trust proxy'), false);
});
await test('서명 실패 추적 Map은 설정된 최대 크기를 넘지 않음', () => {
  const window = new FailureWindow({ windowMs: 60000, limit: 10, maxEntries: 3 });
  for (let index = 0; index < 20; index += 1) window.recordFailure(`user-${index}`);
  assert.equal(window.size, 3);
  window.clear('user-19');
  assert.equal(window.size, 2);
});
await test('background rejection is handled and CMS verification yields', async () => {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    runBackground(() => Promise.reject(new Error('transient test failure')), 'worker test');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /worker test/);
  let invoked = false;
  let timerRan = false;
  const timer = new Promise((resolve) => setTimeout(() => { timerRan = true; resolve(); }, 0));
  const verifiedPromise = verifyCms(Buffer.from([0x30, 0x00]), 'test-ca.pem', async () => {
    invoked = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { stdout: '', stderr: '' };
  });
  const [verified] = await Promise.all([verifiedPromise, timer]);
  assert.equal(invoked, true);
  assert.equal(timerRan, true);
  assert.equal(verified.isTrusted, true);
});
await test('실사용 API 회귀', async (t) => {
  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
    if (
      path.dirname(dir) === path.resolve(os.tmpdir()) &&
      path.basename(dir).startsWith('labhub-test-')
    )
      await rm(dir, { recursive: true, force: true });
  });
  mongo = await MongoMemoryReplSet.create({
    binary: {
      downloadDir: fileURLToPath(
        new URL('../node_modules/.cache/mongodb-memory-server', import.meta.url),
      ),
    },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(mongo.getUri(), { dbName: 'test' });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  await t.test('최초 관리자 설정 및 중복 방지', async () => {
    assert.equal((await request('GET', '/auth/setup')).data.required, true);
    assert.equal(
      (
        await request('POST', '/auth/setup', {
          name: '관리자',
          email: 'admin@example.test',
          password: pass,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request('POST', '/auth/setup', {
          name: '침입',
          email: 'bad@example.test',
          password: pass,
        })
      ).status,
      409,
    );
    admin = await login('admin@example.test');
    assert.ok(admin.token);
    researcher = await makeUser('researcher', 'researcher');
    viewer = await makeUser('viewer', 'viewer');
    other = await makeUser('other', 'researcher');
    reviewer = await makeUser('reviewer', 'admin');
  });
  await t.test('비인증 멤버 조회·생성·수정·삭제 차단', async () => {
    for (const [method, url, body] of [
      ['GET', '/members'],
      ['POST', '/members', { role: 'admin' }],
      ['PUT', `/members/${researcher.user.id}`, { role: 'admin' }],
      ['DELETE', `/members/${researcher.user.id}`],
    ])
      assert.equal((await request(method, url, body)).status, 401);
    const unrelatedMalformedCookie = await fetch(base + '/auth/me', { headers: { Cookie: 'analytics=%ZZ; feature=ok' } });
    assert.equal(unrelatedMalformedCookie.status, 401);
    const malformedSessionCookie = await fetch(base + '/auth/me', { headers: { Cookie: 'labhub_session=%ZZ' } });
    assert.equal(malformedSessionCookie.status, 401);
  });
  await t.test('읽기 전용 쓰기 및 일반 연구원의 관리 기능 차단', async () => {
    for (const url of ['/eln', '/lims', '/templates', '/projects'])
      assert.equal((await request('POST', url, {}, viewer.token)).status, 403);
    assert.equal((await request('POST', '/members', {}, researcher.token)).status, 403);
  });
  await t.test('로그인 입력 객체 주입·짧은 비밀번호·잘못된 ID 차단', async () => {
    assert.equal(
      (await request('POST', '/auth/login', { email: { $ne: null }, password: pass })).status,
      400,
    );
    assert.equal(
      (
        await request(
          'POST',
          '/members',
          { name: 'a', email: 'a@example.test', password: 'x' },
          admin.token,
        )
      ).status,
      400,
    );
    assert.equal((await request('GET', '/eln/not-an-id', null, admin.token)).status, 400);
  });
  await t.test('존재하지 않거나 비활성·잠금 계정도 더미 bcrypt 비교 수행', async () => {
    const inactive = await makeUser('timing-inactive', 'researcher');
    await request('PUT', `/members/${inactive.user.id}`, { isActive: false }, admin.token);
    const locked = await makeUser('timing-locked', 'researcher');
    await User.updateOne({ _id: locked.user.id }, { $set: { lockedUntil: new Date(Date.now() + 60000) } });
    const originalCompare = bcrypt.compare;
    const hashes = [];
    bcrypt.compare = async (candidate, hash) => { hashes.push(hash); return originalCompare(candidate, hash); };
    try {
      assert.equal((await request('POST', '/auth/login', { email: 'timing-unknown@example.test', password: pass })).status, 401);
      assert.equal((await request('POST', '/auth/login', { email: 'timing-inactive@example.test', password: pass })).status, 401);
      assert.equal((await request('POST', '/auth/login', { email: 'timing-locked@example.test', password: pass })).status, 401);
    } finally {
      bcrypt.compare = originalCompare;
    }
    assert.equal(hashes.length, 3);
    assert.equal(new Set(hashes).size, 1);
    assert.notEqual(hashes[0], (await User.findById(inactive.user.id)).password);
    assert.notEqual(hashes[0], (await User.findById(locked.user.id)).password);
  });
  await t.test('개인 노트는 작성자·관리자만 접근', async () => {
    const n = (await createNote(researcher.token)).data;
    assert.equal((await request('GET', `/eln/${n.id}`, null, other.token)).status, 403);
    assert.equal((await request('GET', `/eln/${n.id}/versions`, null, other.token)).status, 403);
    assert.equal((await request('GET', `/eln/${n.id}/export`, null, other.token)).status, 403);
    assert.equal(
      (await request('GET', `/audit/target/ELN/${n.id}`, null, other.token)).status,
      403,
    );
    assert.ok(!(await request('GET', '/eln', null, other.token)).data.items.some((x) => x.id === n.id));
  });
  await t.test('프로젝트 필터·읽기 및 편집 권한', async () => {
    let p = (await request('POST', '/projects', { name: '공동 연구' }, researcher.token)).data;
    assert.equal((await createNote(other.token, { projectId: p._id })).status, 403);
    p = (
      await request(
        'PUT',
        `/projects/${p._id}`,
        { name: p.name, members: [...p.members, { userId: other.user.id, role: 'viewer' }] },
        researcher.token,
      )
    ).data;
    const n = (await createNote(researcher.token, { projectId: p._id })).data;
    assert.equal(n.projectId, p._id);
    assert.equal((await request('GET', `/eln/${n.id}`, null, other.token)).status, 200);
    assert.equal(
      (await request('PUT', `/eln/${n.id}`, { ...n, changeReason: '침입' }, other.token)).status,
      403,
    );
    assert.equal((await createNote(other.token, { projectId: p._id })).status, 403);
  });
  await t.test('HTML 정화 및 긴 본문 저장', async () => {
    const n = await createNote(researcher.token, {
      content:
        '<script>alert(1)</script><img src=x onerror=alert(1)><p>' +
        '결과'.repeat(20000) +
        '</p><a href="javascript:alert(1)">link</a>',
    });
    assert.equal(n.status, 201);
    assert.ok(n.data.content.length > 10000);
    assert.ok(!/script|onerror|<img/i.test(n.data.content));
  });
  await t.test('음수·중복·초과 재고 소모 차단 및 원자성', async () => {
    const i = (await createItem()).data;
    const count = await Note.countDocuments();
    for (const amount of [-1, 0, 11])
      assert.ok(
        (
          await createNote(researcher.token, {
            reagentsUsed: [{ reagentId: i.id, unit: 'mL', amount }],
          })
        ).status >= 400,
      );
    assert.equal(await Note.countDocuments(), count);
    assert.equal((await Item.findById(i.id)).stockValue, 10);
    const r = { reagentId: i.id, unit: 'mL', amount: 1 };
    assert.equal((await createNote(researcher.token, { reagentsUsed: [r, r] })).status, 400);
  });
  await t.test('두 시약 중 두 번째 실패 시 첫 차감도 롤백', async () => {
    const a = (await createItem(10)).data,
      b = (await createItem(1)).data;
    assert.equal(
      (
        await createNote(researcher.token, {
          reagentsUsed: [
            { reagentId: a.id, unit: 'mL', amount: 3 },
            { reagentId: b.id, unit: 'mL', amount: 2 },
          ],
        })
      ).status,
      409,
    );
    assert.equal((await Item.findById(a.id)).stockValue, 10);
  });
  await t.test('동시 소모는 재고 범위 안에서 하나만 성공', async () => {
    const i = (await createItem(5)).data;
    const result = await Promise.all(
      [1, 2].map(() =>
        createNote(researcher.token, {
          reagentsUsed: [{ reagentId: i.id, amount: 4, unit: 'mL' }],
        }),
      ),
    );
    assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await Item.findById(i.id)).stockValue, 1);
  });
  await t.test('시약 정정은 차이만 반환·차감하고 버전·감사 보존', async () => {
    const i = (await createItem()).data;
    let n = (
      await createNote(researcher.token, {
        reagentsUsed: [{ reagentId: i.id, amount: 4, unit: 'mL' }],
      })
    ).data;
    const original = n;
    n = (
      await request(
        'PUT',
        `/eln/${n.id}`,
        {
          ...n,
          title: '수정 제목',
          changeReason: '사용량 정정',
          reagentsUsed: [{ reagentId: i.id, amount: 2, unit: 'mL' }],
        },
        researcher.token,
      )
    ).data;
    assert.equal(n.version, 2);
    assert.equal((await Item.findById(i.id)).stockValue, 8);
    const v = await Version.findOne({ noteId: n.id });
    assert.equal(v.title, original.title);
    const a = await Audit.findOne({ targetId: n.id, action: 'UPDATE' });
    assert.equal(a.previousState.title, original.title);
    assert.equal(a.newState.title, '수정 제목');
    assert.equal(
      (
        await request(
          'PUT',
          `/eln/${n.id}`,
          { ...original, changeReason: '늦은 수정' },
          researcher.token,
        )
      ).status,
      409,
    );
  });
  await t.test('동시 본문 저장은 한 버전만 성공', async () => {
    const n = (await createNote(researcher.token)).data;
    const result = await Promise.all(
      ['A', 'B'].map((title) =>
        request(
          'PUT',
          `/eln/${n.id}`,
          { ...n, title, changeReason: '동시 수정' },
          researcher.token,
        ),
      ),
    );
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await Version.countDocuments({ noteId: n.id }), 1);
  });
  await t.test('빈 본문도 수정 이력 보관 및 사유 필수', async () => {
    const n = (await createNote(researcher.token, { content: '' })).data;
    assert.equal(
      (await request('PUT', `/eln/${n.id}`, { ...n, content: '<p>기록</p>' }, researcher.token))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          'PUT',
          `/eln/${n.id}`,
          { ...n, content: '<p>기록</p>', changeReason: '내용 작성' },
          researcher.token,
        )
      ).status,
      200,
    );
  });
  await t.test('승인 상태 전이·잠금·자기 승인 차단 및 내용 해시', async () => {
    let n = (await createNote(admin.token)).data;
    assert.equal(
      (
        await request(
          'POST',
          `/eln/${n.id}/approve`,
          { version: n.version, password: pass },
          reviewer.token,
        )
      ).status,
      409,
    );
    n = (
      await request('POST', `/eln/${n.id}/request-approval`, { version: n.version, password: pass }, admin.token)
    ).data;
    assert.equal(
      (await request('PUT', `/eln/${n.id}`, { ...n, changeReason: '잠금 우회' }, admin.token))
        .status,
      409,
    );
    assert.equal(
      (
        await request(
          'POST',
          `/eln/${n.id}/approve`,
          { version: n.version, password: pass },
          admin.token,
        )
      ).status,
      403,
    );
    n = (
      await request(
        'POST',
        `/eln/${n.id}/approve`,
        { version: n.version, password: pass, comment: '검토 완료' },
        reviewer.token,
      )
    ).data;
    assert.equal(n.status, '승인됨');
    assert.equal(n.signatures[0].contentHash.length, 64);
    for (const route of ['request-approval', 'cancel-approval', 'approve', 'reject'])
      assert.equal(
        (
          await request(
            'POST',
            `/eln/${n.id}/${route}`,
            { version: n.version, password: pass, comment: '재시도' },
            reviewer.token,
          )
        ).status,
        409,
      );
    assert.equal(
      (await request('DELETE', `/eln/${n.id}`, { version: n.version }, admin.token)).status,
      409,
    );
  });
  await t.test('반려 사유 필수·비밀번호 오류는 세션 유지·반려 후 수정', async () => {
    let n = (await createNote(researcher.token)).data;
    n = (
      await request(
        'POST',
        `/eln/${n.id}/request-approval`,
        { version: n.version, password: pass },
        researcher.token,
      )
    ).data;
    assert.equal(
      (
        await request(
          'POST',
          `/eln/${n.id}/reject`,
          { version: n.version, password: pass },
          admin.token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          'POST',
          `/eln/${n.id}/approve`,
          { version: n.version, password: 'wrong' },
          admin.token,
        )
      ).status,
      400,
    );
    n = (
      await request(
        'POST',
        `/eln/${n.id}/reject`,
        { version: n.version, password: pass, comment: '추가 관찰 필요' },
        admin.token,
      )
    ).data;
    assert.equal(n.status, '반려');
    assert.equal(
      (await request('PUT', `/eln/${n.id}`, { ...n, changeReason: '보완' }, researcher.token)).data
        .status,
      '진행중',
    );
  });
  await t.test('휴지통·복원은 사용 재고를 변경하지 않음', async () => {
    const i = (await createItem()).data;
    let n = (
      await createNote(researcher.token, {
        reagentsUsed: [{ reagentId: i.id, unit: 'mL', amount: 2 }],
      })
    ).data;
    n = (await request('DELETE', `/eln/${n.id}`, { version: n.version }, researcher.token)).data;
    assert.equal((await request('GET', `/eln/${n.id}`, null, researcher.token)).status, 404);
    assert.ok(
      (await request('GET', '/eln?trash=true', null, researcher.token)).data.items.some(
        (x) => x.id === n.id,
      ),
    );
    n = (await request('POST', `/eln/${n.id}/restore`, { version: n.version }, researcher.token))
      .data;
    assert.equal(n.isDeleted, false);
    assert.equal((await Item.findById(i.id)).stockValue, 8);
  });
  await t.test('시약 수정 유효성·부분 수정·버전 충돌', async () => {
    const i = (await createItem()).data;
    assert.equal(
      (await request('PUT', `/lims/${i.id}`, { stockValue: -1, version: i.version }, admin.token))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          'PUT',
          `/lims/${i.id}`,
          { name: '이름만 변경', version: i.version },
          admin.token,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request('PUT', `/lims/${i.id}`, { stockValue: 5, version: i.version }, admin.token))
        .status,
      409,
    );
    assert.equal((await Item.findById(i.id)).stockValue, 10);
  });
  await t.test('최소 재고·재입고 상태 및 유효기간 판정', async () => {
    const i = (await createItem(1)).data;
    let r = await request(
      'PUT',
      `/lims/${i.id}`,
      { version: i.version, minimumStock: 2 },
      admin.token,
    );
    assert.equal(r.data.status, '부족');
    const lot = (await request('GET', `/lims/${i.id}/lots`, null, admin.token)).data[0];
    r = await request('POST', `/lims/lots/${lot.id}/adjust`, { version: lot.version, delta: 4, reason: '최소 재고 확인' }, admin.token);
    assert.equal(r.data.status, '양호');
    assert.equal(
      (
        await request(
          'PUT',
          `/lims/${i.id}`,
          { version: r.data.version, expirationDate: '2026-02-31' },
          admin.token,
        )
      ).status,
      400,
    );
    r = await request(
      'PUT',
      `/lims/${i.id}`,
      { version: r.data.version, expirationDate: '2020-01-01' },
      admin.token,
    );
    assert.equal(r.data.status, '만료');
  });
  await t.test('첨부 인증·권한·버전·잠금·비공개 저장', async () => {
    let n = (await createNote(researcher.token)).data;
    async function upload(token, version = n.version) {
      const f = new FormData();
      f.append('noteId', n.id);
      f.append('version', version);
      f.append('file', new Blob(['evidence']), 'result.txt');
      return fetch(base + '/files/upload', {
        method: 'POST',
      headers: { Cookie: `labhub_session=${token}`, 'X-LabHub-Request': '1' },
        body: f,
      });
    }
    assert.equal((await upload(other.token)).status, 403);
    const r = await upload(researcher.token);
    assert.equal(r.status, 201);
    const f = (await r.json()).file;
    assert.ok(f.sha256);
    assert.equal(f.path, undefined);
    assert.equal((await request('GET', `/files/${f._id}/download`)).status, 401);
    assert.equal((await request('GET', `/files/${f._id}/download`, null, other.token)).status, 403);
    const dl = await fetch(base + `/files/${f._id}/download`, {
      headers: { Cookie: `labhub_session=${researcher.token}` },
    });
    assert.equal(await dl.text(), 'evidence');
    assert.equal((await upload(researcher.token, 1)).status, 409);
    n = (await request('GET', `/eln/${n.id}`, null, researcher.token)).data;
    const ex = (await request('GET', `/eln/${n.id}/export`, null, researcher.token)).data;
    assert.equal(ex.attachments.length, 1);
    assert.equal(ex.attachments[0].path, undefined);
    n = (
      await request(
        'POST',
        `/eln/${n.id}/request-approval`,
        { version: n.version, password: pass },
        researcher.token,
      )
    ).data;
    assert.equal((await upload(researcher.token)).status, 409);
    assert.equal(
      (await request('DELETE', `/files/${f._id}`, { version: n.version }, researcher.token)).status,
      409,
    );
  });
  await t.test('저장 응답 유실 후 재시도는 중복 노트·차감 방지', async () => {
    const i = (await createItem()).data,
      requestId = '12345678-1234-1234-1234-123456789abc';
    const body = { requestId, reagentsUsed: [{ reagentId: i.id, amount: 2, unit: 'mL' }] };
    const [a, b] = await Promise.all([
      createNote(researcher.token, body),
      createNote(researcher.token, body),
    ]);
    assert.ok([200, 201].includes(a.status));
    assert.ok([200, 201].includes(b.status));
    assert.equal(a.data.id, b.data.id);
    assert.equal(await Note.countDocuments({ requestId }), 1);
    assert.equal((await Item.findById(i.id)).stockValue, 8);
    assert.equal(
      (await createNote(researcher.token, { ...body, title: '응답 유실 뒤 수정한 내용' })).status,
      409,
    );
  });
  await t.test('동시 관리자 삭제에도 관리 계정 유지', async () => {
    const a = await makeUser('guard-a', 'admin'),
      b = await makeUser('guard-b', 'admin');
    const result = await Promise.all([
      request('DELETE', `/members/${a.user.id}`, {}, b.token),
      request('DELETE', `/members/${b.user.id}`, {}, a.token),
    ]);
    assert.ok(result.some((r) => r.status === 200));
    assert.ok(result.some((r) => [401, 403].includes(r.status)));
      assert.equal(await User.countDocuments({ _id: { $in: [a.user.id, b.user.id] } }), 2);
      assert.equal(await User.countDocuments({ _id: { $in: [a.user.id, b.user.id] }, isActive: true }), 1);
  });
  await t.test('삭제·권한 변경·로그아웃 토큰 즉시 무효화', async () => {
    const temp = await makeUser('temporary', 'researcher');
    assert.equal(
      (
        await request(
          'PUT',
          `/members/${temp.user.id}`,
          { ...temp.user, role: 'viewer' },
          admin.token,
        )
      ).status,
      200,
    );
    assert.equal((await request('GET', '/auth/me', null, temp.token)).status, 401);
    const fresh = await login('temporary@example.test');
    await request('DELETE', `/members/${fresh.user.id}`, {}, admin.token);
    assert.equal((await request('GET', '/auth/me', null, fresh.token)).status, 401);
    await request('POST', '/auth/logout', {}, other.token);
    assert.equal((await request('GET', '/auth/me', null, other.token)).status, 401);
  });
  await t.test('쿠키 세션·CSRF 계약', async () => {
    const result = await request('POST', '/auth/login', { email: 'admin@example.test', password: pass });
    assert.equal(result.status, 200);
    assert.equal(result.data.token, undefined);
    assert.match(result.cookie, /labhub_session=/);
    assert.match(result.cookie, /HttpOnly/i);
    assert.match(result.cookie, /SameSite=Strict/i);
    const cookie = /labhub_session=([^;]+)/.exec(result.cookie)[1];
    const bearerOnly = await fetch(base + '/auth/me', { headers: { Authorization: `Bearer ${cookie}` } });
    assert.equal(bearerOnly.status, 401);
    const blocked = await fetch(base + '/projects', { method: 'POST', headers: { Cookie: `labhub_session=${cookie}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'CSRF 차단' }) });
    assert.equal(blocked.status, 403);
  });
  await t.test('계정별 로그인 잠금·존재하지 않는 계정 실패 감사', async () => {
    const account = await makeUser('login-lock', 'researcher');
    const before = await Audit.countDocuments({ action: 'LOGIN_FAILED' });
    for (let i = 0; i < 5; i++) assert.equal((await request('POST', '/auth/login', { email: 'login-lock@example.test', password: 'wrong-password' })).status, 401);
    assert.equal((await request('POST', '/auth/login', { email: 'login-lock@example.test', password: pass })).status, 401);
    const locked = await User.findById(account.user.id);
    assert.ok(locked.lockedUntil > new Date());
    assert.equal((await request('POST', '/auth/login', { email: 'missing-account@example.test', password: pass })).status, 401);
    assert.ok(await Audit.countDocuments({ action: 'LOGIN_FAILED' }) >= before + 7);
    const unknown = await Audit.findOne({ action: 'LOGIN_FAILED', targetType: 'AUTH', targetId: { $ne: String(locked._id) } }).sort({ createdAt: -1 });
    assert.equal(unknown?.targetId?.includes('@'), false);
  });
  await t.test('프로젝트 manager만 검토 가능하고 취소 시 작성자 서명 무효화', async () => {
    const author = await makeUser('matrix-author', 'researcher');
    const manager = await makeUser('matrix-manager', 'researcher');
    const editor = await makeUser('matrix-editor', 'researcher');
    const viewerAccount = await makeUser('matrix-viewer', 'viewer');
    let project = (await request('POST', '/projects', { name: '서명 권한 프로젝트', endDate: '2030-01-01' }, author.token)).data;
    project = (await request('PUT', `/projects/${project._id}`, { name: project.name, members: [
      ...project.members,
      { userId: manager.user.id, role: 'manager' },
      { userId: editor.user.id, role: 'editor' },
      { userId: viewerAccount.user.id, role: 'manager' },
    ] }, author.token)).data;
    assert.equal(project.endDate.slice(0, 10), '2030-01-01');
    let note = (await createNote(author.token, { projectId: project._id })).data;
    note = (await request('POST', `/eln/${note.id}/request-approval`, { version: note.version, password: pass }, author.token)).data;
    const invalidatedId = note.signatures.find((item) => item.role === 'author')._id;
    const cancelled = await request('POST', `/eln/${note.id}/cancel-approval`, { version: note.version }, author.token);
    assert.equal(cancelled.data.status, '진행중');
    assert.equal(cancelled.data.signatures.find((item) => String(item._id) === String(invalidatedId)).isValid, false);
    note = (await request('POST', `/eln/${note.id}/request-approval`, { version: cancelled.data.version, password: pass }, author.token)).data;
    assert.equal((await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, editor.token)).status, 403);
    assert.equal((await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, viewerAccount.token)).status, 403);
    assert.equal((await request('POST', `/eln/${note.id}/reject`, { version: note.version, password: pass, comment: 'viewer must not reject' }, viewerAccount.token)).status, 403);
    assert.equal((await request('POST', `/eln/${note.id}/cancel-approval`, { version: note.version }, viewerAccount.token)).status, 403);
    const approved = await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, manager.token);
    assert.equal(approved.data.status, '승인됨');
    assert.equal((await request('POST', `/eln/${note.id}/seal/timestamp/retry`, {}, viewerAccount.token)).status, 403);
    const seal = await Seal.findOne({ noteId: note.id });
    assert.equal(seal.retainUntil.toISOString().slice(0, 10), '2060-01-01');
  });
  await t.test('성공한 서명은 서명 실패 제한을 소모하지 않음', async () => {
    const approver = await makeUser('repeat-approver', 'admin');
    for (let index = 0; index < 11; index += 1) {
      let note = (await createNote(researcher.token, { title: `반복 승인 ${index}` })).data;
      const requested = await request('POST', `/eln/${note.id}/request-approval`, { version: note.version, password: pass }, researcher.token);
      assert.equal(requested.status, 200);
      note = requested.data;
      const approved = await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, approver.token);
      assert.equal(approved.status, 200);
    }
  });
  await t.test('점검자 자격·봉인·PDF·공개 검증·변조 탐지·불변성', async () => {
    const author = await makeUser('seal-author', 'researcher');
    const created = await createNote(author.token, { content: '<h2>본문</h2><p>검증할 기록</p>', tags: ['시험'] });
    let note = created.data;
    note = (await request('POST', `/eln/${note.id}/request-approval`, { version: note.version, password: pass }, author.token)).data;
    assert.equal(note.status, '승인대기');
    assert.ok(note.signatures.some((item) => item.role === 'author' && item.signature));
    assert.equal((await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, author.token)).status, 403);
    note = (await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass, comment: '확인' }, reviewer.token)).data;
    assert.equal(note.status, '승인됨');
    assert.ok(note.seal.verifyId);
    const sealResult = await request('GET', `/eln/${note.id}/seal`, null, author.token);
    assert.equal(sealResult.status, 200);
    assert.equal(sealResult.data.pdfPath, undefined);
    assert.equal(sealResult.data.timestamp.status, 'not_configured');
    const seal = await Seal.findById(sealResult.data._id);
    const verified = await request('GET', `/eln/${note.id}/seal/verify`, null, author.token);
    assert.equal(verified.data.valid, true);
    assert.ok(verified.data.checks.every((check) => check.ok || ['timestamp'].includes(check.id)));
    const pdfResponse = await fetch(base + `/eln/${note.id}/seal/pdf`, { headers: { Cookie: `labhub_session=${author.token}` } });
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get('content-type'), /application\/pdf/);
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(pdf.byteLength > 1000, true);
    assert.match(pdf.subarray(0, 8).toString(), /%PDF-1\.7/);
    assert.ok(pdf.includes(Buffer.from('/Metadata')));
    assert.ok(pdf.includes(Buffer.from('/OutputIntents')));
    const bundleResponse = await fetch(base + `/eln/${note.id}/seal/bundle`, { headers: { Cookie: `labhub_session=${author.token}` } });
    assert.equal(bundleResponse.status, 200);
    const zip = Buffer.from(await bundleResponse.arrayBuffer());
    assert.equal(zip.subarray(0, 4).toString('hex'), '504b0304');
    const entries = unzipSync(zip);
    assert.ok(entries['note.pdf'] && entries['manifest.json'] && entries['verify.mjs']);
    const evidenceDir = await mkdtemp(path.join(dir, 'evidence-bundle-'));
    for (const [name, contents] of Object.entries(entries)) await writeFile(path.join(evidenceDir, name), contents);
    await execFile(process.execPath, ['verify.mjs'], { cwd: evidenceDir });
    const originalPdfBytes = Buffer.from(entries['note.pdf']);
    originalPdfBytes[originalPdfBytes.length - 1] ^= 1;
    await writeFile(path.join(evidenceDir, 'note.pdf'), originalPdfBytes);
    await assert.rejects(() => execFile(process.execPath, ['verify.mjs'], { cwd: evidenceDir }));
    await writeFile(path.join(evidenceDir, 'note.pdf'), entries['note.pdf']);
    const alteredManifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
    alteredManifest.manifest.title += ' altered';
    await writeFile(path.join(evidenceDir, 'manifest.json'), JSON.stringify(alteredManifest));
    await assert.rejects(() => execFile(process.execPath, ['verify.mjs'], { cwd: evidenceDir }));
    const publicResult = await request('GET', `/public/verify/${seal.verifyId}`);
    assert.equal(publicResult.status, 200);
    assert.equal(publicResult.data.valid, true);
    assert.equal(publicResult.data.pdfSha256, seal.pdfSha256);
    for (const field of ['title', 'content', 'author', 'name', 'manifest', 'signatures', 'pdfPath']) assert.equal(field in publicResult.data, false);
    await assert.rejects(() => Seal.updateOne({ _id: seal._id }, { $set: { manifest: {} } }), /봉인 기록/);
    await assert.rejects(() => Seal.deleteOne({ _id: seal._id }), /봉인 기록/);
    const originalManifest = seal.manifest;
    await mongoose.connection.collection('noteseals').updateOne({ _id: seal._id }, { $set: { 'manifest.content': 'tampered' } });
    let checks = (await request('GET', `/eln/${note.id}/seal/verify`, null, author.token)).data.checks;
    assert.equal(checks.find((check) => check.id === 'manifest').ok, false);
    await mongoose.connection.collection('noteseals').updateOne({ _id: seal._id }, { $set: { manifest: originalManifest } });
    const originalPdf = await readStored(seal);
    await replaceStored(seal, Buffer.concat([originalPdf, Buffer.from('tamper')]));
    checks = (await request('GET', `/eln/${note.id}/seal/verify`, null, author.token)).data.checks;
    assert.equal(checks.find((check) => check.id === 'pdf').ok, false);
    await replaceStored(seal, originalPdf);
    const authorSig = seal.signatures.find((item) => item.role === 'author');
    await mongoose.connection.collection('noteseals').updateOne({ _id: seal._id }, { $set: { 'signatures.0.signature': 'AAAA' } });
    checks = (await request('GET', `/eln/${note.id}/seal/verify`, null, author.token)).data.checks;
    assert.equal(checks.find((check) => check.id === 'signature:author').ok, false);
    await mongoose.connection.collection('noteseals').updateOne({ _id: seal._id }, { $set: { 'signatures.0.signature': authorSig.signature } });
    const audit = await Audit.findOne({ chainKey: `SEAL:${String(seal._id)}` });
    await assert.rejects(() => Audit.updateOne({ _id: audit._id }, { $set: { description: '변경' } }), /감사 기록/);
    await assert.rejects(() => Audit.deleteOne({ _id: audit._id }), /감사 기록/);
  });
  await t.test('MFA 전체 흐름과 복구 코드 1회 사용', async () => {
    const account = await makeUser('mfa-cycle', 'researcher');
    const setup = await request('POST', '/auth/mfa/setup', { password: pass }, account.token);
    assert.equal(setup.status, 200);
    assert.match(setup.data.otpauthUrl, /^otpauth:\/\/totp\//);
    const enabled = await request('POST', '/auth/mfa/enable', { code: generateTotp(setup.data.secret) }, account.token);
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.recoveryCodes.length, 10);
    let loginResult = await request('POST', '/auth/login', { email: 'mfa-cycle@example.test', password: pass });
    assert.equal(loginResult.data.mfaRequired, true);
    assert.equal(loginResult.cookie, null);
    const tokenVersion = (await User.findById(account.user.id)).tokenVersion;
    for (const token of [
      loginResult.data.mfaToken,
      jwt.sign({ id: account.user.id, tokenVersion, scope: 'other' }, jwtSecret, { algorithm: 'HS256', expiresIn: '5m' }),
      jwt.sign({ id: account.user.id, tokenVersion }, jwtSecret, { algorithm: 'HS256', expiresIn: '5m' }),
    ]) {
      const bypass = await fetch(base + '/auth/me', { headers: { Cookie: `labhub_session=${token}` } });
      assert.equal(bypass.status, 401);
    }
    assert.equal((await request('POST', '/auth/login/mfa', { mfaToken: loginResult.data.mfaToken, code: 42 })).status, 401);
    assert.equal((await request('POST', '/auth/login/mfa', { mfaToken: loginResult.data.mfaToken, code: { token: 'x' } })).status, 401);
    let completed = await request('POST', '/auth/login/mfa', { mfaToken: loginResult.data.mfaToken, code: generateTotp(setup.data.secret) });
    assert.equal(completed.status, 200);
    const mfaCookie = /labhub_session=([^;]+)/.exec(completed.cookie)[1];
    loginResult = await request('POST', '/auth/login', { email: 'mfa-cycle@example.test', password: pass });
    completed = await request('POST', '/auth/login/mfa', { mfaToken: loginResult.data.mfaToken, code: enabled.data.recoveryCodes[0] });
    assert.equal(completed.status, 200);
    loginResult = await request('POST', '/auth/login', { email: 'mfa-cycle@example.test', password: pass });
    assert.equal((await request('POST', '/auth/login/mfa', { mfaToken: loginResult.data.mfaToken, code: enabled.data.recoveryCodes[0] })).status, 401);
    assert.equal((await request('POST', '/auth/mfa/disable', { password: pass, code: generateTotp(setup.data.secret) }, mfaCookie)).status, 200);
    assert.equal((await request('GET', '/auth/me', null, mfaCookie)).status, 401);
    assert.equal((await request('POST', '/auth/login', { email: 'mfa-cycle@example.test', password: pass })).data.mfaRequired, undefined);
  });
  await t.test('서명 키 비밀번호 재암호화·관리자 재설정 폐기·과거 서명 보존', async () => {
    const account = await makeUser('key-lifecycle', 'researcher');
    let note = (await createNote(account.token)).data;
    note = (await request('POST', `/eln/${note.id}/request-approval`, { version: note.version, password: pass }, account.token)).data;
    const authorSignature = note.signatures.find((item) => item.role === 'author');
    assert.equal(verifySignature(authorSignature.publicKey, authorSignature.manifestSha256, authorSignature.signature), true);
    let key = await SigningKey.findOne({ userId: account.user.id, active: true });
    const keyId = key.keyId;
    const nextPassword = 'Changed-passphrase-2026';
    assert.equal((await request('PUT', '/auth/password', { currentPassword: pass, newPassword: nextPassword }, account.token)).status, 200);
    key = await SigningKey.findOne({ userId: account.user.id, active: true });
    assert.equal(key.keyId, keyId);
    const privateKey = await decryptSigningKey(key, nextPassword);
    assert.equal(crypto.verify(null, Buffer.from(authorSignature.manifestSha256), key.publicKey, Buffer.from(authorSignature.signature, 'base64')), true);
    await request('PUT', `/members/${account.user.id}`, { password: 'Reset-passphrase-2026' }, admin.token);
    key = await SigningKey.findOne({ userId: account.user.id, keyId });
    assert.equal(key.active, false);
    assert.ok(key.revokedAt);
    assert.equal(verifySignature(authorSignature.publicKey, authorSignature.manifestSha256, authorSignature.signature), true);
    const resetLogin = await request('POST', '/auth/login', { email: 'key-lifecycle@example.test', password: 'Reset-passphrase-2026' });
    const newToken = /labhub_session=([^;]+)/.exec(resetLogin.cookie)[1];
    const nextNote = (await createNote(newToken)).data;
    const nextSigned = (await request('POST', `/eln/${nextNote.id}/request-approval`, { version: nextNote.version, password: 'Reset-passphrase-2026' }, newToken)).data;
    const nextKey = await SigningKey.findOne({ userId: account.user.id, active: true });
    assert.notEqual(nextKey.keyId, keyId);
    assert.equal(verifySignature(nextSigned.signatures[0].publicKey, nextSigned.signatures[0].manifestSha256, nextSigned.signatures[0].signature), true);
  });
  await t.test('첨부 변조 거부·승인 후 정정은 시약 재고를 다시 차감하지 않음', async () => {
    const account = await makeUser('amend-author', 'researcher');
    const item = (await createItem()).data;
    let note = (await createNote(account.token, { reagentsUsed: [{ reagentId: item.id, amount: 2, unit: 'mL' }] })).data;
    const form = new FormData();
    form.append('noteId', note.id); form.append('version', String(note.version)); form.append('file', new Blob(['original attachment']), 'evidence.txt');
    const upload = await fetch(base + '/files/upload', { method: 'POST', headers: { Cookie: `labhub_session=${account.token}`, 'X-LabHub-Request': '1' }, body: form });
    assert.equal(upload.status, 201);
    const file = await upload.json();
    note = (await request('GET', `/eln/${note.id}`, null, account.token)).data;
    note = (await request('POST', `/eln/${note.id}/request-approval`, { version: note.version, password: pass }, account.token)).data;
    const attachment = await Attachment.findById(file.file._id);
    const original = await readStored(attachment);
    await replaceStored(attachment, Buffer.from('altered attachment'));
    const failed = await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, reviewer.token);
    assert.equal(failed.status, 409);
    assert.match(failed.data.message, /evidence\.txt/);
    await replaceStored(attachment, original);
    const approved = await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, reviewer.token);
    assert.equal(approved.data.status, '승인됨');
    const stock = (await Item.findById(item.id)).stockValue;
    const amendment = await request('POST', `/eln/${note.id}/amend`, { reason: '측정값 보정' }, account.token);
    assert.equal(amendment.status, 201);
    assert.equal(amendment.data.amendsNoteId, note.id);
    assert.equal(amendment.data.reagentsUsed.length, 0);
    assert.equal((await Item.findById(item.id)).stockValue, stock);
    const originalNote = await request('GET', `/eln/${note.id}`, null, account.token);
    assert.equal(originalNote.data.supersededBy, amendment.data.id);
    assert.equal((await request('POST', `/eln/${note.id}/amend`, { reason: '중복 정정' }, account.token)).status, 409);
    const deleted = await request('DELETE', `/eln/${amendment.data.id}`, { version: amendment.data.version }, account.token);
    assert.equal(deleted.status, 200);
    assert.equal((await request('GET', `/eln/${note.id}`, null, account.token)).data.supersededBy, null);
    const replacement = await request('POST', `/eln/${note.id}/amend`, { reason: '삭제한 초안 대체' }, account.token);
    assert.equal(replacement.status, 201);
    assert.equal(replacement.data.amendmentNo, 1);
    assert.equal((await request('POST', `/eln/${amendment.data.id}/restore`, { version: deleted.data.version }, account.token)).status, 409);
    const requested = await request('POST', `/eln/${replacement.data.id}/request-approval`, { version: replacement.data.version, password: pass }, account.token);
    assert.equal(requested.status, 200);
    const approvedReplacement = await request('POST', `/eln/${replacement.data.id}/approve`, { version: requested.data.version, password: pass }, admin.token);
    assert.equal(approvedReplacement.data.status, '승인됨');
    const nested = await request('POST', `/eln/${replacement.data.id}/amend`, { reason: '두 번째 정정' }, account.token);
    assert.equal(nested.status, 201);
    assert.equal(nested.data.amendmentNo, 2);
  });
  await t.test('가짜 RFC 3161 TSA 정상·nonce/imprint 불일치·장애 후 재시도', async () => {
    const fake = await startFakeTsa();
    const old = { provider: process.env.TIMESTAMP_PROVIDER, url: process.env.TSA_URL, ca: process.env.TSA_CA_CERT };
    process.env.TIMESTAMP_PROVIDER = 'rfc3161';
    process.env.TSA_URL = fake.url;
    delete process.env.TSA_CA_CERT;
    try {
      const hash = 'a'.repeat(64);
      let provider = getTimestampProvider();
      const granted = await provider.request(hash);
      assert.equal(granted.status, 'granted');
      assert.equal(granted.isTrusted, false);
      assert.equal((await provider.verify(granted.tokenBase64, hash)).status, 'granted');
      fake.setMode('mismatch-nonce');
      await assert.rejects(() => provider.request(hash), (error) => error.code === 'TSA_INVALID_RESPONSE');
      fake.setMode('mismatch-imprint');
      await assert.rejects(() => provider.request(hash), (error) => error.code === 'TSA_INVALID_RESPONSE');
      fake.setMode('error');
      const id = new mongoose.Types.ObjectId();
      const testSeal = await Seal.create({ verifyId: crypto.randomBytes(16).toString('base64url'), noteId: id, noteVersion: 1, manifest: { marker: 'test' }, manifestSha256: hash, pdfPath: path.join(dir, 'missing.pdf'), pdfSha256: 'b'.repeat(64), signatures: [], sealHash: 'c'.repeat(64), timestamp: { provider: 'rfc3161', status: 'pending', attempts: 0, nextAttemptAt: new Date() } });
      await processSealTimestamp(testSeal._id);
      let stored = await Seal.findById(testSeal._id);
      assert.equal(stored.timestamp.status, 'pending');
      assert.equal(stored.timestamp.attempts, 1);
      fake.setMode('normal');
      await mongoose.connection.collection('noteseals').updateOne({ _id: testSeal._id }, { $set: { 'timestamp.nextAttemptAt': new Date(0) } });
      await processPendingTimestamps();
      stored = await Seal.findById(testSeal._id);
      assert.equal(stored.timestamp.status, 'granted');
      assert.equal(stored.timestamp.attempts, 2);
      const unknownProviderSeal = await Seal.create({ verifyId: crypto.randomBytes(16).toString('base64url'), noteId: new mongoose.Types.ObjectId(), noteVersion: 1, manifest: { marker: 'unknown-provider' }, manifestSha256: hash, pdfPath: path.join(dir, 'missing-unknown.pdf'), pdfSha256: 'd'.repeat(64), signatures: [], sealHash: 'e'.repeat(64), timestamp: { provider: 'unknown-provider', status: 'pending', attempts: 0, nextAttemptAt: new Date(0) } });
      await processPendingTimestamps();
      const unknownStored = await Seal.findById(unknownProviderSeal._id);
      assert.equal(unknownStored.timestamp.status, 'pending');
      assert.equal(unknownStored.timestamp.attempts, 1);
      assert.match(unknownStored.timestamp.lastError, /알 수 없는 시점인증 공급자/);
      const oldNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      await assert.rejects(() => getTimestampProvider('dev-local').request(hash), /운영 환경/);
      process.env.NODE_ENV = oldNodeEnv;
    } finally {
      await fake.close();
      if (old.provider === undefined) delete process.env.TIMESTAMP_PROVIDER; else process.env.TIMESTAMP_PROVIDER = old.provider;
      if (old.url === undefined) delete process.env.TSA_URL; else process.env.TSA_URL = old.url;
      if (old.ca === undefined) delete process.env.TSA_CA_CERT; else process.env.TSA_CA_CERT = old.ca;
    }
  });
  await t.test('복합 감사 레코드 DB 왕복 후 체인 검증', async () => {
    const actor = await makeUser('audit-roundtrip', 'researcher');
    const item = (await createItem(10)).data;
    let note = (await createNote(actor.token, { title: '감사 왕복', reagentsUsed: [{ reagentId: item.id, amount: 2, unit: 'mL' }] })).data;
    const updated = await request('PUT', `/eln/${note.id}`, { title: note.title, content: '<p>변경 내용</p>', tags: ['감사'], projectId: null, reagentsUsed: [{ reagentId: item.id, amount: 3, unit: 'mL' }], version: note.version, changeReason: '복합 감사 검증' }, actor.token);
    assert.equal(updated.status, 200);
    note = updated.data;
    const form = new FormData();
    form.append('noteId', note.id); form.append('version', String(note.version)); form.append('file', new Blob(['audit attachment']), 'audit.txt');
    const upload = await fetch(base + '/files/upload', { method: 'POST', headers: { Cookie: `labhub_session=${actor.token}`, 'X-LabHub-Request': '1' }, body: form });
    assert.equal(upload.status, 201);
    note = (await request('GET', `/eln/${note.id}`, null, actor.token)).data;
    note = (await request('POST', `/eln/${note.id}/request-approval`, { version: note.version, password: pass }, actor.token)).data;
    const approved = await request('POST', `/eln/${note.id}/approve`, { version: note.version, password: pass }, admin.token);
    assert.equal(approved.data.status, '승인됨');
    assert.equal((await request('POST', `/eln/${note.id}/amend`, { reason: '감사 왕복 정정' }, actor.token)).status, 201);
    assert.equal((await request('POST', '/auth/login', { email: 'audit-roundtrip@example.test', password: pass })).status, 200);
    const storedItem = await Item.findById(item.id);
    const lot = (await request('GET', `/lims/${item.id}/lots`, null, admin.token)).data[0];
    const adjustment = await request('POST', `/lims/lots/${lot.id}/adjust`, { version: lot.version, delta: 1, reason: '감사 왕복 재고 조정' }, admin.token);
    assert.equal(adjustment.status, 200);
    const history = await Audit.find({ targetType: 'ELN', targetId: note.id }).sort({ seq: 1 });
    const nested = history.find((record) => record.action === 'UPDATE' && record.previousState?.reagentsUsed?.length);
    assert.ok(nested);
    assert.ok(nested.createdAt instanceof Date);
    assert.ok(nested.previousState.reagentsUsed[0].reagentId instanceof mongoose.Types.ObjectId);
    const verified = await request('GET', '/audit/verify?page=1&limit=200', null, admin.token);
    assert.equal(verified.status, 200);
    assert.equal(verified.data.valid, true);
  });
  await t.test('감사 페이지네이션·동시 기록·체인 변조 탐지·앵커', async () => {
    const sealed = await Note.findOne({ status: '승인됨', authorId: researcher.user.id });
    if (sealed) {
      const [a, b] = await Promise.all([
        request('GET', `/eln/${sealed._id}/export`, null, researcher.token),
        request('GET', `/eln/${sealed._id}/export`, null, researcher.token),
      ]);
      assert.equal(a.status, 200); assert.equal(b.status, 200);
    }
    const page = await request('GET', '/audit?page=1&limit=5', null, admin.token);
    assert.equal(page.status, 200);
    assert.equal(page.data.items.length <= 5, true);
    assert.equal(page.data.page, 1);
    const verified = await request('GET', '/audit/verify?page=1&limit=200', null, admin.token);
    assert.equal(verified.status, 200);
    assert.equal(verified.data.valid, true);
    const record = await Audit.findOne({ hash: { $type: 'string' } }).sort({ createdAt: -1 });
    const original = record.description;
    await mongoose.connection.collection('auditlogs').updateOne({ _id: record._id }, { $set: { description: 'tampered audit' } });
    const tampered = await request('GET', '/audit/verify?page=1&limit=200', null, admin.token);
    assert.equal(tampered.data.valid, false);
    assert.ok(tampered.data.brokenAt.length);
    await mongoose.connection.collection('auditlogs').updateOne({ _id: record._id }, { $set: { description: original } });
    await assert.rejects(() => Audit.updateOne({ _id: record._id }, { $set: { description: 'blocked' } }), /감사 기록/);
    const oldProvider = process.env.TIMESTAMP_PROVIDER;
    process.env.TIMESTAMP_PROVIDER = 'none';
    try {
      const anchor = await createAuditAnchor({ force: true });
      assert.ok(anchor);
      assert.equal((await Anchor.findById(anchor._id)).root.length, 64);
      await assert.rejects(() => Anchor.updateOne({ _id: anchor._id }, { $set: { root: 'bad' } }), /감사 앵커/);
    } finally {
      if (oldProvider === undefined) delete process.env.TIMESTAMP_PROVIDER; else process.env.TIMESTAMP_PROVIDER = oldProvider;
    }
  });
});
