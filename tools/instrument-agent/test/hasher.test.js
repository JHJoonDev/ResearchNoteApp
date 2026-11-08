import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { computeFileHashAndVerify, computeIdempotencyKey } from '../src/hasher.js';

test('hasher - 파일 해싱 중 mtime 또는 크기 변경 시 예외 발생 검증', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-hasher-'));
  const testFile = path.join(tmpDir, 'mutating.dat');
  fs.writeFileSync(testFile, 'initial data for hashing');
  const initialStat = fs.statSync(testFile);

  // 1) 변경 없는 정상 해싱
  const hash1 = await computeFileHashAndVerify(testFile, initialStat);
  const expectedHash = crypto.createHash('sha256').update('initial data for hashing').digest('hex');
  assert.equal(hash1, expectedHash);

  // 2) preStat과 실제 디스크 파일의 mtime이 상이한 경우 (해싱 중 변경 감지)
  const modifiedStat = {
    size: initialStat.size,
    mtimeMs: initialStat.mtimeMs - 5000, // 불일치
  };

  await assert.rejects(
    async () => {
      await computeFileHashAndVerify(testFile, modifiedStat);
    },
    (err) => {
      assert.ok(err.message.includes('FILE_MODIFIED_DURING_HASH'));
      return true;
    },
  );

  // 3) 크기가 변경된 경우
  const modifiedSizeStat = {
    size: initialStat.size + 10,
    mtimeMs: initialStat.mtimeMs,
  };

  await assert.rejects(
    async () => {
      await computeFileHashAndVerify(testFile, modifiedSizeStat);
    },
    (err) => {
      assert.ok(err.message.includes('FILE_MODIFIED_DURING_HASH'));
      return true;
    },
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('hasher - Idempotency-Key 계산 규칙 검증', () => {
  const instrumentId = 'HPLC-UV-01';
  const relativePath = 'data/run1.raw';
  const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const key = computeIdempotencyKey(instrumentId, relativePath, sha256);
  const expected = crypto
    .createHash('sha256')
    .update(instrumentId + relativePath + sha256)
    .digest('hex');

  assert.equal(key, expected);
});
