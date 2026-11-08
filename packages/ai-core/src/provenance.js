/**
 * @fileoverview Provenance 메타데이터 생성 및 SHA-256 해시 계산
 */

import crypto from 'node:crypto';

/**
 * 객체의 키를 정렬하여 결정론적(deterministic) JSON 문자열을 생성합니다.
 * @param {unknown} val
 * @returns {string}
 */
export function stableStringify(val) {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(item => stableStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${stableStringify(val[k])}`).join(',') + '}';
}

/**
 * 임의의 데이터에 대한 SHA-256 16진수 해시를 계산합니다.
 * @param {unknown} data
 * @returns {string}
 */
export function computeSha256(data) {
  let str;
  if (typeof data === 'string') {
    str = data;
  } else if (Buffer.isBuffer(data)) {
    return crypto.createHash('sha256').update(data).digest('hex');
  } else {
    str = stableStringify(data);
  }
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * 감사 로그용 provenance 객체를 구성합니다.
 *
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.model
 * @param {string|null} [params.requestId]
 * @param {string} params.feature
 * @param {unknown} params.input
 * @param {unknown} params.output
 * @param {string[]} [params.sourceIds]
 * @param {{ input_tokens?: number, output_tokens?: number }} [params.usage]
 * @param {string} [params.createdAt]
 * @returns {{
 *   provider: string,
 *   model: string,
 *   requestId: string,
 *   feature: string,
 *   inputSha256: string,
 *   outputSha256: string,
 *   sourceIds: string[],
 *   usage: { input_tokens: number, output_tokens: number },
 *   createdAt: string
 * }}
 */
export function buildProvenance({
  provider,
  model,
  requestId,
  feature,
  input,
  output,
  sourceIds = [],
  usage,
  createdAt = new Date().toISOString(),
}) {
  return {
    provider,
    model,
    requestId: requestId || crypto.randomUUID(),
    feature,
    inputSha256: computeSha256(input),
    outputSha256: computeSha256(output),
    sourceIds: Array.isArray(sourceIds) ? [...sourceIds] : [],
    usage: {
      input_tokens: Number.isInteger(usage?.input_tokens) ? usage.input_tokens : 0,
      output_tokens: Number.isInteger(usage?.output_tokens) ? usage.output_tokens : 0,
    },
    createdAt,
  };
}
