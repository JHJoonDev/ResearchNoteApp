import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from '../src/state.js';

test('state - 원자적 저장 및 재시작 시 상태 복원', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-state-'));
  const store1 = new StateStore(tmpDir, 'inst-01');
  await store1.init();

  store1.setFileRecord('data/sample1.raw', {
    mtimeMs: 1700000000000,
    size: 2048,
    sha256: 'abc123456789',
    status: 'uploaded',
  });

  await store1.save();

  // 새로운 인스턴스로 재시작 시뮬레이션
  const store2 = new StateStore(tmpDir, 'inst-01');
  await store2.init();

  const rec = store2.getFileRecord('data/sample1.raw');
  assert.notEqual(rec, null);
  assert.equal(rec.sha256, 'abc123456789');
  assert.equal(rec.status, 'uploaded');

  // 상태 파일 내용 검사: API 키 관련 문자열이 절대 저장되지 않음
  const rawContent = fs.readFileSync(store2.stateFilePath, 'utf8');
  assert.ok(!rawContent.toLowerCase().includes('bearer'));
  assert.ok(!rawContent.toLowerCase().includes('apikey'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('state - 손상된 상태 파일 감지, 백업 보존 및 안전 복구', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-corrupt-'));
  const store = new StateStore(tmpDir, 'inst-02');
  await store.init();

  // 상태 파일에 고의로 유효하지 않은 JSON 기록 (손상 시뮬레이션)
  fs.writeFileSync(store.stateFilePath, '{ broken json content !! @#$%', 'utf8');

  // 재로드 시도
  const recoverStore = new StateStore(tmpDir, 'inst-02');
  await recoverStore.init();

  // 손상 파일이 백업본으로 보존되었는지 확인
  const files = fs.readdirSync(tmpDir);
  const backupFile = files.find((f) => f.includes('.corrupt.'));
  assert.ok(backupFile !== undefined, '손상 상태 백업 파일이 생성되어야 함');

  // 백업 파일 내용 확인
  const backupContent = fs.readFileSync(path.join(tmpDir, backupFile), 'utf8');
  assert.ok(backupContent.includes('broken json content'));

  // 복구된 저장소는 정상적으로 동작해야 함
  assert.equal(recoverStore.files.size, 0);
  recoverStore.setFileRecord('test.raw', { status: 'uploaded' });
  await recoverStore.save();

  assert.equal(recoverStore.getFileRecord('test.raw').status, 'uploaded');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('state - 상태 압축 (삭제된 파일 정리)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-compact-'));
  const store = new StateStore(tmpDir, 'inst-03');
  await store.init();

  store.setFileRecord('active.raw', { status: 'uploaded' });
  store.setFileRecord('deleted_old.raw', {
    status: 'failed',
    updatedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const activePaths = new Set(['active.raw']);
  await store.compact(activePaths);

  assert.notEqual(store.getFileRecord('active.raw'), null);
  assert.equal(store.getFileRecord('deleted_old.raw'), null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
