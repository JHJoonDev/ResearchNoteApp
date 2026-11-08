import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { FakeServer } from './fake-server.js';
import { InstrumentAgent } from '../src/agent.js';
import { computeIdempotencyKey } from '../src/hasher.js';

test('agent - 소스 파일 불변성 검증 (내용 및 mtime 절대 변경 없음)', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-immutable-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    const testFile = path.join(watchDir, 'raw_data.bin');
    const originalBytes = Buffer.from('Original Instrument Measurement Data 2026');
    fs.writeFileSync(testFile, originalBytes);

    const pastTime = new Date(Date.now() - 30000);
    fs.utimesSync(testFile, pastTime, pastTime);
    const preStat = fs.statSync(testFile);

    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'agent-key-secret',
      instrumentId: 'INST-001',
      watch: [{ path: watchDir, include: ['*'], exclude: [] }],
      scanIntervalSec: 10,
      stableSec: 5,
      maxFileSizeMb: 100,
      concurrency: 1,
      stateDir,
    });

    const success = await agent.runOnce();
    assert.equal(success, true);

    const postStat = fs.statSync(testFile);
    const postBytes = fs.readFileSync(testFile);

    assert.equal(postBytes.equals(originalBytes), true, '파일 내용이 변경되지 않아야 함');
    assert.equal(postStat.mtimeMs, preStat.mtimeMs, '파일 mtime이 변경되지 않아야 함');
    assert.equal(postStat.size, preStat.size, '파일 크기가 변경되지 않아야 함');
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 작성 중인 파일은 안정화(stableSec) 전까지 업로드되지 않음', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-stable-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    const testFile = path.join(watchDir, 'writing.log');
    fs.writeFileSync(testFile, 'part 1...');

    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'key',
      instrumentId: 'INST-002',
      watch: [{ path: watchDir }],
      stableSec: 5,
      stateDir,
      concurrency: 1,
    });

    await agent.runOnce();
    assert.equal(server.requests.length, 0);

    const oldTime = new Date(Date.now() - 10000);
    fs.utimesSync(testFile, oldTime, oldTime);

    await agent.runOnce();
    assert.equal(server.requests.length, 1);
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 재시작 시 변경 없는 파일 재업로드 방지 및 내용 변경 시 새 버전 업로드', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-restart-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    const testFile = path.join(watchDir, 'sample.csv');
    fs.writeFileSync(testFile, 'v1 content');
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(testFile, oldTime, oldTime);

    const config = {
      serverUrl: server.url,
      apiKey: 'key',
      instrumentId: 'INST-003',
      watch: [{ path: watchDir }],
      stableSec: 2,
      stateDir,
      concurrency: 1,
    };

    const agent1 = new InstrumentAgent(config);
    await agent1.runOnce();
    assert.equal(server.requests.length, 1);

    const idempotencyV1 = server.requests[0].headers['idempotency-key'];

    const agent2 = new InstrumentAgent(config);
    await agent2.runOnce();
    assert.equal(server.requests.length, 1);

    fs.writeFileSync(testFile, 'v2 updated content');
    fs.utimesSync(testFile, oldTime, oldTime);

    const agent3 = new InstrumentAgent(config);
    await agent3.runOnce();
    assert.equal(server.requests.length, 2);

    const idempotencyV2 = server.requests[1].headers['idempotency-key'];
    assert.notEqual(idempotencyV1, idempotencyV2, '새 버전은 새 멱등성 키를 가져야 함');
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 업로드 실패 후 재시도 시 동일한 Idempotency-Key 유지', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-retry-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    const testFile = path.join(watchDir, 'transient.dat');
    fs.writeFileSync(testFile, 'retry payload');
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(testFile, oldTime, oldTime);

    let attempt = 0;
    server.setHandler(() => {
      attempt++;
      if (attempt === 1) {
        return { status: 503, body: { message: 'Server unavailable' } };
      }
      return { status: 201, body: { id: 'ok-after-retry' } };
    });

    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'key',
      instrumentId: 'INST-004',
      watch: [{ path: watchDir }],
      stableSec: 1,
      stateDir,
      concurrency: 1,
    });

    await agent.runOnce();
    assert.equal(server.requests.length, 1);
    const key1 = server.requests[0].headers['idempotency-key'];

    const rec = agent.state.getFileRecord('transient.dat');
    rec.nextRetryAt = 0;
    await agent.state.save();

    await agent.runOnce();
    assert.equal(server.requests.length, 2);
    const key2 = server.requests[1].headers['idempotency-key'];

    assert.equal(key1, key2, '재시도 시 멱등성 키는 이전과 동일해야 함');
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 401/403 발생 시 모든 업로드 일시 중단(pause)', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-auth-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    fs.writeFileSync(path.join(watchDir, 'file1.dat'), 'f1');
    fs.writeFileSync(path.join(watchDir, 'file2.dat'), 'f2');
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(path.join(watchDir, 'file1.dat'), oldTime, oldTime);
    fs.utimesSync(path.join(watchDir, 'file2.dat'), oldTime, oldTime);

    server.setHandler(() => ({
      status: 401,
      body: { message: 'Invalid API Key' },
    }));

    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'invalid-key',
      instrumentId: 'INST-005',
      watch: [{ path: watchDir }],
      stableSec: 1,
      stateDir,
      concurrency: 1,
    });

    const success = await agent.runOnce();
    assert.equal(success, false, '인증 실패 시 runOnce는 false를 반환해야 함');
    assert.equal(agent.state.paused, true, '인증 실패 시 상태가 paused여야 함');
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 대용량 sparse 파일 업로드 시 메모리 상한 유지 (스트리밍 검증)', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-sparse-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    const sparseFile = path.join(watchDir, 'sparse_100mb.bin');
    const fh = fs.openSync(sparseFile, 'w');
    fs.writeSync(fh, Buffer.from('SPARSE_HEADER'), 0, 13, 0);
    fs.writeSync(fh, Buffer.from('SPARSE_FOOTER'), 0, 13, 100 * 1024 * 1024 - 13);
    fs.closeSync(fh);

    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(sparseFile, oldTime, oldTime);

    server.setHandler(() => ({
      status: 201,
      body: { id: 'sparse-ok' },
    }));

    const initialHeap = process.memoryUsage().heapUsed;

    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'key',
      instrumentId: 'INST-006',
      watch: [{ path: watchDir }],
      stableSec: 1,
      maxFileSizeMb: 200,
      stateDir,
      concurrency: 1,
    });

    await agent.runOnce();

    const finalHeap = process.memoryUsage().heapUsed;
    const heapDiffMb = (finalHeap - initialHeap) / (1024 * 1024);

    assert.ok(heapDiffMb < 50, `힙 메모리 증가량(${heapDiffMb}MB)이 50MB 미만이어야 함`);
    assert.equal(server.requests.length, 1);
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 동시성 제한(concurrency) 준수 검증', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-conc-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    for (let i = 0; i < 4; i++) {
      const fPath = path.join(watchDir, `file_${i}.dat`);
      fs.writeFileSync(fPath, `data_${i}`);
      const oldTime = new Date(Date.now() - 20000);
      fs.utimesSync(fPath, oldTime, oldTime);
    }

    let currentActive = 0;
    let maxObservedActive = 0;

    server.setHandler((req, rawBody) => {
      currentActive++;
      if (currentActive > maxObservedActive) {
        maxObservedActive = currentActive;
      }

      const start = Date.now();
      while (Date.now() - start < 20) {}

      currentActive--;
      return { status: 201, body: { id: 'ok' } };
    });

    const CONCURRENCY_LIMIT = 2;
    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'key',
      instrumentId: 'INST-007',
      watch: [{ path: watchDir }],
      stableSec: 1,
      stateDir,
      concurrency: CONCURRENCY_LIMIT,
    });

    await agent.runOnce();

    assert.ok(
      maxObservedActive <= CONCURRENCY_LIMIT,
      `동시 실행 수(${maxObservedActive})가 제한(${CONCURRENCY_LIMIT})을 초과하지 않아야 함`,
    );
    assert.equal(server.requests.length, 4);
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 400/413/415 발생 시 영구 실패 처리 및 재스캔 시 중복 시도 건너뜀', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-perm-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    const badFile = path.join(watchDir, 'bad_file.bin');
    fs.writeFileSync(badFile, 'bad payload');
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(badFile, oldTime, oldTime);

    server.setHandler(() => ({
      status: 415,
      body: { message: '지원되지 않는 형식' },
    }));

    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'key',
      instrumentId: 'INST-008',
      watch: [{ path: watchDir }],
      stableSec: 1,
      stateDir,
      concurrency: 1,
    });

    const success1 = await agent.runOnce();
    assert.equal(success1, false, '영구 실패 파일이 있으면 runOnce는 false를 반환해야 함');
    assert.equal(server.requests.length, 1);

    const rec = agent.state.getFileRecord('bad_file.bin');
    assert.equal(rec.status, 'failed');
    assert.equal(rec.permanentlyFailed, true);

    const success2 = await agent.runOnce();
    assert.equal(success2, false);
    assert.equal(server.requests.length, 1);
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('agent - 422 서버 해시 불일치 시 1회 재해시 및 재시도 후 성공 검증', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-422-'));
  try {
    const watchDir = path.join(tmpDir, 'watch');
    const stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(watchDir, { recursive: true });

    const testFile = path.join(watchDir, 'retry422.dat');
    fs.writeFileSync(testFile, 'hash mismatch payload');
    const oldTime = new Date(Date.now() - 20000);
    fs.utimesSync(testFile, oldTime, oldTime);

    let attempts = 0;
    server.setHandler(() => {
      attempts++;
      if (attempts === 1) {
        return { status: 422, body: { message: '해시 불일치' } };
      }
      return { status: 201, body: { id: 'recovered-422' } };
    });

    const agent = new InstrumentAgent({
      serverUrl: server.url,
      apiKey: 'key',
      instrumentId: 'INST-009',
      watch: [{ path: watchDir }],
      stableSec: 1,
      stateDir,
      concurrency: 1,
    });

    const success = await agent.runOnce();
    assert.equal(success, true, '422 1회 재시도 후 성공 시 runOnce는 true');
    assert.equal(server.requests.length, 2, '422 발생 후 1회 재시도하여 총 2회 요청');

    const rec = agent.state.getFileRecord('retry422.dat');
    assert.equal(rec.status, 'uploaded');
    assert.equal(rec.permanentlyFailed, false);
  } finally {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
