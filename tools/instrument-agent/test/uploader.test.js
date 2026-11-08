import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { FakeServer } from './fake-server.js';
import { uploadFileStream } from '../src/uploader.js';
import { computeIdempotencyKey } from '../src/hasher.js';

test('uploader - 멀티파트 스트리밍 요청 및 헤더/필드 검증', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-upload-'));
  const testFile = path.join(tmpDir, '측정 시료_01.csv');
  const fileContent = 'time,val\n0,10.5\n1,12.3\n';
  fs.writeFileSync(testFile, fileContent, 'utf8');

  const stat = fs.statSync(testFile);
  const sha256 = crypto.createHash('sha256').update(fileContent).digest('hex');
  const instrumentId = 'HPLC-UV-01';
  const relativePath = 'raw/측정 시료_01.csv';
  const apiKey = 'test-secret-key-123';

  server.setHandler((req, rawBody, headers) => {
    // 1) 헤더 검증
    assert.equal(headers['authorization'], `Bearer ${apiKey}`);
    const expectedIdempotency = computeIdempotencyKey(instrumentId, relativePath, sha256);
    assert.equal(headers['idempotency-key'], expectedIdempotency);
    assert.ok(headers['content-type'].includes('multipart/form-data; boundary='));

    // 2) 바디 필드 포함 검증
    assert.ok(rawBody.includes(`name="instrumentId"\r\n\r\n${instrumentId}`));
    assert.ok(rawBody.includes(`name="relativePath"\r\n\r\n${relativePath}`));
    assert.ok(rawBody.includes(`name="sha256"\r\n\r\n${sha256}`));
    assert.ok(rawBody.includes('name="capturedAt"'));
    assert.ok(rawBody.includes('name="file"; filename='));
    assert.ok(rawBody.includes(fileContent));

    return {
      status: 201,
      body: { id: 'file-uuid-001', status: 'stored' },
    };
  });

  const res = await uploadFileStream({
    serverUrl: server.url,
    apiKey,
    instrumentId,
    relativePath,
    absolutePath: testFile,
    fileSize: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256,
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.id, 'file-uuid-001');

  await server.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('uploader - 서버 응답 상태 코드별 처리 검증 (200 중복, 400/413/415 거부, 422 불일치, 429 Retry-After)', async () => {
  const server = new FakeServer();
  await server.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-upload-codes-'));
  const testFile = path.join(tmpDir, 'test.dat');
  fs.writeFileSync(testFile, 'dummy data');
  const stat = fs.statSync(testFile);

  const baseParams = {
    serverUrl: server.url,
    apiKey: 'key',
    instrumentId: 'inst-1',
    relativePath: 'test.dat',
    absolutePath: testFile,
    fileSize: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };

  // 1) 200 { id, duplicate: true }
  server.setHandler(() => ({
    status: 200,
    body: { id: 'dup-1', duplicate: true },
  }));
  const res200 = await uploadFileStream(baseParams);
  assert.equal(res200.statusCode, 200);
  assert.equal(res200.body.duplicate, true);

  // 2) 400 Bad Request
  server.setHandler(() => ({
    status: 400,
    body: { message: '잘못된 요청 형식' },
  }));
  const res400 = await uploadFileStream(baseParams);
  assert.equal(res400.statusCode, 400);

  // 3) 413 Payload Too Large
  server.setHandler(() => ({
    status: 413,
    body: { message: '파일 크기 초과' },
  }));
  const res413 = await uploadFileStream(baseParams);
  assert.equal(res413.statusCode, 413);

  // 4) 415 Unsupported Media Type
  server.setHandler(() => ({
    status: 415,
    body: { message: '지원되지 않는 미디어 타입' },
  }));
  const res415 = await uploadFileStream(baseParams);
  assert.equal(res415.statusCode, 415);

  // 5) 422 Unprocessable Entity (해시 불일치)
  server.setHandler(() => ({
    status: 422,
    body: { message: '해시 불일치' },
  }));
  const res422 = await uploadFileStream(baseParams);
  assert.equal(res422.statusCode, 422);

  // 6) 429 Too Many Requests with Retry-After: 30
  server.setHandler(() => ({
    status: 429,
    headers: { 'Retry-After': '30', 'Content-Type': 'application/json' },
    body: { message: 'Rate limit' },
  }));
  const res429 = await uploadFileStream(baseParams);
  assert.equal(res429.statusCode, 429);
  assert.equal(res429.retryAfterSec, 30);

  await server.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
