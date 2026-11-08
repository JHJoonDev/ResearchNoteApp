import crypto from 'node:crypto';

function normalized(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS에는 유한한 숫자만 사용할 수 있습니다.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value.toJSON === 'function') return normalized(value.toJSON());
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError('JCS 입력에 undefined를 사용할 수 없습니다.');
      out[key] = normalized(value[key]);
    }
    return out;
  }
  throw new TypeError('지원하지 않는 JCS 값입니다.');
}

export function canonicalize(value) {
  return JSON.stringify(normalized(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonicalize(value)).digest('hex');
}
