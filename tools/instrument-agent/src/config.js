/**
 * @fileoverview 에이전트 설정 검증 및 API 키 로딩 모듈
 */

import fs from 'node:fs';
import path from 'node:path';
import { registerSecret } from './logger.js';

export const DEFAULT_CONFIG = Object.freeze({
  scanIntervalSec: 30,
  stableSec: 10,
  maxFileSizeMb: 1024,
  concurrency: 2,
  stateDir: './state',
});

/**
 * URL이 안전한 HTTPS 주소이거나 로컬 개발용(localhost / 127.0.0.1)인지 검증합니다.
 * @param {string} urlString
 * @returns {URL}
 */
export function validateServerUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    throw new Error('serverUrl 설정이 누락되었거나 비어있습니다.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlString.trim());
  } catch (err) {
    throw new Error(`serverUrl 형식이 올바르지 않습니다: ${err.message}`);
  }

  const protocol = parsedUrl.protocol;
  const hostname = parsedUrl.hostname;

  if (protocol === 'https:') {
    return parsedUrl;
  }

  if (protocol === 'http:') {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return parsedUrl;
    }
    throw new Error(
      `원격 서버 URL은 반드시 https:// 여야 합니다. (입력된 호스트: ${hostname})`,
    );
  }

  throw new Error(`지원되지 않는 URL 프로토콜 '${protocol}'입니다. https:// 또는 로컬 http:// 만 허용됩니다.`);
}

/**
 * 환경변수 또는 파일로부터 API 키를 안전하게 로드합니다.
 * @param {string} [apiKeyFile]
 * @returns {string}
 */
export function loadApiKey(apiKeyFile) {
  const envKey = process.env.LABHUB_API_KEY;
  if (typeof envKey === 'string' && envKey.trim().length > 0) {
    const key = envKey.trim();
    registerSecret(key);
    return key;
  }

  if (typeof apiKeyFile === 'string' && apiKeyFile.trim().length > 0) {
    const resolvedPath = path.resolve(apiKeyFile.trim());
    if (fs.existsSync(resolvedPath)) {
      const fileKey = fs.readFileSync(resolvedPath, 'utf8').trim();
      if (fileKey.length > 0) {
        registerSecret(fileKey);
        return fileKey;
      }
    } else {
      throw new Error(`apiKeyFile을 찾을 수 없습니다: ${resolvedPath}`);
    }
  }

  throw new Error(
    'API 키가 제공되지 않았습니다. LABHUB_API_KEY 환경변수를 설정하거나 apiKeyFile 경로를 지정해주세요.',
  );
}

/**
 * 설정 파일 객체 또는 경로를 검증하고 기본값을 병합한 설정 객체를 반환합니다.
 * @param {string | Record<string, any>} rawInput
 * @param {{ skipApiKey?: boolean }} [options]
 * @returns {Record<string, any>}
 */
export function loadConfig(rawInput, options = {}) {
  let rawConfig = {};

  if (typeof rawInput === 'string') {
    const configPath = path.resolve(rawInput);
    if (!fs.existsSync(configPath)) {
      throw new Error(`설정 파일을 찾을 수 없습니다: ${configPath}`);
    }
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      rawConfig = JSON.parse(content);
    } catch (err) {
      throw new Error(`설정 파일(JSON)을 파싱할 수 없습니다: ${err.message}`);
    }
  } else if (rawInput && typeof rawInput === 'object') {
    rawConfig = { ...rawInput };
  } else {
    throw new Error('유효한 설정 객체 또는 파일 경로가 필요합니다.');
  }

  // 필수 항목 검증
  const serverUrl = validateServerUrl(rawConfig.serverUrl);

  if (typeof rawConfig.instrumentId !== 'string' || !rawConfig.instrumentId.trim()) {
    throw new Error('instrumentId 설정이 필요합니다.');
  }

  if (!Array.isArray(rawConfig.watch) || rawConfig.watch.length === 0) {
    throw new Error('watch 설정에 최소 1개 이상의 감시 디렉토리가 필요합니다.');
  }

  const normalizedWatch = rawConfig.watch.map((item, index) => {
    if (!item || typeof item.path !== 'string' || !item.path.trim()) {
      throw new Error(`watch[${index}].path 설정이 올바르지 않습니다.`);
    }
    return {
      path: path.resolve(item.path.trim()),
      include: Array.isArray(item.include) ? item.include : [],
      exclude: Array.isArray(item.exclude) ? item.exclude : [],
    };
  });

  const scanIntervalSec = Number.isInteger(rawConfig.scanIntervalSec) && rawConfig.scanIntervalSec > 0
    ? rawConfig.scanIntervalSec
    : DEFAULT_CONFIG.scanIntervalSec;

  const stableSec = Number.isInteger(rawConfig.stableSec) && rawConfig.stableSec >= 0
    ? rawConfig.stableSec
    : DEFAULT_CONFIG.stableSec;

  const maxFileSizeMb = Number.isFinite(rawConfig.maxFileSizeMb) && rawConfig.maxFileSizeMb > 0
    ? rawConfig.maxFileSizeMb
    : DEFAULT_CONFIG.maxFileSizeMb;

  const concurrency = Number.isInteger(rawConfig.concurrency) && rawConfig.concurrency > 0
    ? rawConfig.concurrency
    : DEFAULT_CONFIG.concurrency;

  const stateDir = typeof rawConfig.stateDir === 'string' && rawConfig.stateDir.trim()
    ? path.resolve(rawConfig.stateDir.trim())
    : path.resolve(DEFAULT_CONFIG.stateDir);

  const apiKey = options.skipApiKey ? null : loadApiKey(rawConfig.apiKeyFile);

  return {
    serverUrl: serverUrl.origin + (serverUrl.pathname === '/' ? '' : serverUrl.pathname).replace(/\/$/, ''),
    instrumentId: rawConfig.instrumentId.trim(),
    watch: normalizedWatch,
    scanIntervalSec,
    stableSec,
    maxFileSizeMb,
    concurrency,
    stateDir,
    apiKey,
  };
}
