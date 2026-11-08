import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateServerUrl, loadApiKey, loadConfig } from '../src/config.js';
import { sanitize, clearSecrets } from '../src/logger.js';

test('config - URL 보안 검증: 원격 http:// 거부 및 https:// 허용', () => {
  // 1) 원격 http 거부
  assert.throws(
    () => validateServerUrl('http://labhub.example.com'),
    (err) => err.message.includes('원격 서버 URL은 반드시 https://'),
  );

  assert.throws(
    () => validateServerUrl('http://192.168.1.50:5000'),
    (err) => err.message.includes('원격 서버 URL은 반드시 https://'),
  );

  // 2) localhost 및 127.0.0.1은 http 허용
  const local1 = validateServerUrl('http://localhost:5000/api');
  assert.equal(local1.hostname, 'localhost');

  const local2 = validateServerUrl('http://127.0.0.1:3000');
  assert.equal(local2.hostname, '127.0.0.1');

  // 3) 원격 https 허용
  const remoteHttps = validateServerUrl('https://eln.company.internal/api/v1');
  assert.equal(remoteHttps.protocol, 'https:');
});

test('config - API 키 안전 로딩 및 로그/상태 마스킹 검증', () => {
  clearSecrets();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labhub-agent-key-'));
  const keyFile = path.join(tmpDir, 'secret.key');
  const secretKey = 'super-secret-labhub-api-key-999';

  fs.writeFileSync(keyFile, `  ${secretKey} \n`, 'utf8');

  // 1) apiKeyFile로부터 로드
  const loadedKey = loadApiKey(keyFile);
  assert.equal(loadedKey, secretKey);

  // 2) 로거 마스킹 검증 (절대 로그에 노출되지 않음)
  const logMessage = `Authorization: Bearer ${secretKey}`;
  const sanitized = sanitize(logMessage);
  assert.ok(!sanitized.includes(secretKey));
  assert.ok(sanitized.includes('[REDACTED_API_KEY]'));

  // 객체 내부 마스킹 검증
  const sanitizedObj = sanitize({ apiKey: secretKey, other: 'data', nested: { token: secretKey } });
  assert.equal(sanitizedObj.apiKey, '[REDACTED_API_KEY]');
  assert.equal(sanitizedObj.nested.token, '[REDACTED_API_KEY]');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('config - 필수 설정 누락 시 에러 검증', () => {
  assert.throws(
    () => loadConfig({ serverUrl: 'https://labhub.io' }, { skipApiKey: true }),
    (err) => err.message.includes('instrumentId 설정이 필요'),
  );

  assert.throws(
    () => loadConfig({ serverUrl: 'https://labhub.io', instrumentId: 'inst-1' }, { skipApiKey: true }),
    (err) => err.message.includes('watch 설정에 최소 1개 이상'),
  );
});
