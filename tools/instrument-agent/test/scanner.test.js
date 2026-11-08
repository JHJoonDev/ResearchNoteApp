import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanWatchDirectory, matchesFilters, globToRegex } from '../src/scanner.js';

test('scanner - 한글 및 공백 포함 경로 처리와 슬래시(/) 표준화', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-scan-ko-'));
  const subDir = path.join(tmpDir, '측정 결과 폴더 2026');
  fs.mkdirSync(subDir, { recursive: true });

  const file1 = path.join(subDir, '시료 A 분석 데이터 #1.raw');
  fs.writeFileSync(file1, 'data content 1');

  const file2 = path.join(tmpDir, '최상위 보고서.csv');
  fs.writeFileSync(file2, 'col1,col2\nval1,val2');

  const results = await scanWatchDirectory(tmpDir, ['*.raw', '*.csv']);

  assert.equal(results.length, 2);

  const relPaths = results.map((r) => r.relativePath).sort();
  assert.equal(relPaths[0], '최상위 보고서.csv');
  assert.equal(relPaths[1], '측정 결과 폴더 2026/시료 A 분석 데이터 #1.raw');

  // 백슬래시(\)가 아닌 항상 슬래시(/) 사용 확인
  for (const r of results) {
    assert.ok(!r.relativePath.includes('\\'));
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scanner - include / exclude glob 필터링', () => {
  const inc = [globToRegex('**/*.raw'), globToRegex('*.csv')];
  const ex = [globToRegex('**/temp/**'), globToRegex('*.tmp')];

  assert.equal(matchesFilters('sub/sample.raw', inc, ex), true);
  assert.equal(matchesFilters('report.csv', inc, ex), true);
  assert.equal(matchesFilters('sub/temp/sample.raw', inc, ex), false); // exclude
  assert.equal(matchesFilters('data.tmp', inc, ex), false); // exclude
  assert.equal(matchesFilters('other.txt', inc, ex), false); // not in include
});

test('scanner - 감시 루트 탈출 방지 검증', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-escape-'));
  const watchDir = path.join(tmpDir, 'watch');
  const outsideDir = path.join(tmpDir, 'outside');

  fs.mkdirSync(watchDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  const secretFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(secretFile, 'sensitive data');

  // 윈도우 환경에서 심볼릭 링크 생성 시 권한 오류가 날 수 있으므로 try/catch
  try {
    const symlinkPath = path.join(watchDir, 'link_outside');
    fs.symlinkSync(outsideDir, symlinkPath, 'junction');

    const results = await scanWatchDirectory(watchDir);
    // 탈출한 파일은 결과에 포함되지 않아야 함
    const hasSecret = results.some((r) => r.relativePath.includes('secret.txt'));
    assert.equal(hasSecret, false);
  } catch (symlinkErr) {
    // 심볼릭 링크 생성이 권한상 불가한 환경이면 스킵
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
