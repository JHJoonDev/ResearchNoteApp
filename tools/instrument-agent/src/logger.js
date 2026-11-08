/**
 * @fileoverview 구조화된 JSON 로거 (표준 출력, 비밀 정보 마스킹 지원)
 */

let registeredSecrets = [];

/**
 * 로거에 마스킹할 비밀 정보(API 키 등)를 등록합니다.
 * @param {string} secret
 */
export function registerSecret(secret) {
  if (typeof secret === 'string' && secret.trim().length > 0) {
    if (!registeredSecrets.includes(secret.trim())) {
      registeredSecrets.push(secret.trim());
    }
  }
}

/**
 * 등록된 비밀 목록을 초기화합니다 (테스트용).
 */
export function clearSecrets() {
  registeredSecrets = [];
}

/**
 * 문자열 또는 객체 내에 포함된 비밀 정보를 [REDACTED] 처리합니다.
 * @param {any} value
 * @returns {any}
 */
export function sanitize(value) {
  if (typeof value === 'string') {
    let result = value;
    for (const secret of registeredSecrets) {
      if (secret && result.includes(secret)) {
        result = result.replaceAll(secret, '[REDACTED_API_KEY]');
      }
    }
    return result;
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item));
    }
    const sanitizedObj = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.toLowerCase().includes('apikey') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('token')) {
        sanitizedObj[k] = '[REDACTED_API_KEY]';
      } else {
        sanitizedObj[k] = sanitize(v);
      }
    }
    return sanitizedObj;
  }

  return value;
}

/**
 * 구조화된 JSON 로그를 출력합니다.
 * @param {'debug' | 'info' | 'warn' | 'error'} level
 * @param {string} message
 * @param {Record<string, any>} [meta]
 */
function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitize(message),
    ...sanitize(meta),
  };
  const jsonLine = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(jsonLine + '\n');
  } else {
    process.stdout.write(jsonLine + '\n');
  }
}

export const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
