/**
 * @fileoverview 스트리밍 SHA-256 해시 계산 및 전후 무결성 검증
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * 스트림 방식으로 파일의 SHA-256을 계산하고 해싱 후 크기 및 mtime 변화를 재검증합니다.
 * 파일 수정은 절대 하지 않으며 읽기 전용으로만 접근합니다.
 *
 * @param {string} filePath
 * @param {{ size: number, mtimeMs: number }} preStat
 * @returns {Promise<string>} sha256 hex string
 */
export async function computeFileHashAndVerify(filePath, preStat) {
  const hash = crypto.createHash('sha256');
  const readStream = fs.createReadStream(filePath, { flags: 'r', highWaterMark: 64 * 1024 });

  await new Promise((resolve, reject) => {
    readStream.on('data', (chunk) => hash.update(chunk));
    readStream.on('error', reject);
    readStream.on('end', resolve);
  });

  const sha256 = hash.digest('hex');

  // 해싱 직후 파일의 크기와 mtime을 다시 확인하여 해싱 도중 변경되었는지 검증
  const postStat = await fs.promises.stat(filePath);
  if (postStat.size !== preStat.size || postStat.mtimeMs !== preStat.mtimeMs) {
    throw new Error('FILE_MODIFIED_DURING_HASH: 해시 계산 중 파일이 변경되었습니다.');
  }

  return sha256;
}

/**
 * 멱등성 키(Idempotency-Key)를 계산합니다.
 * 명세: sha256 of instrumentId + relativePath + sha256
 * @param {string} instrumentId
 * @param {string} relativePath
 * @param {string} fileSha256
 * @returns {string}
 */
export function computeIdempotencyKey(instrumentId, relativePath, fileSha256) {
  return crypto
    .createHash('sha256')
    .update(String(instrumentId) + String(relativePath) + String(fileSha256))
    .digest('hex');
}
