/**
 * @fileoverview 스트리밍 멀티파트 파일 업로더 및 응답 처리 모듈
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { computeIdempotencyKey } from './hasher.js';
import { logger } from './logger.js';

/**
 * @typedef {Object} UploadFileParams
 * @property {string} serverUrl
 * @property {string} apiKey
 * @property {string} instrumentId
 * @property {string} relativePath
 * @property {string} absolutePath
 * @property {number} fileSize
 * @property {number} mtimeMs
 * @property {string} sha256
 */

/**
 * 단일 파일 스트리밍 업로드를 실행합니다.
 * @param {UploadFileParams} params
 * @returns {Promise<{ statusCode: number, body: any, retryAfterSec?: number }>}
 */
export async function uploadFileStream(params) {
  const {
    serverUrl,
    apiKey,
    instrumentId,
    relativePath,
    absolutePath,
    fileSize,
    mtimeMs,
    sha256,
  } = params;

  const idempotencyKey = computeIdempotencyKey(instrumentId, relativePath, sha256);
  const capturedAt = new Date(mtimeMs).toISOString();
  const filename = path.basename(absolutePath);

  const parsedUrl = new URL(`${serverUrl.replace(/\/$/, '')}/api/v1/inbox/files`);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const boundary = `----LabHubBoundary${crypto.randomBytes(16).toString('hex')}`;

  const preamble =
    `--${boundary}\r\nContent-Disposition: form-data; name="instrumentId"\r\n\r\n${instrumentId}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="relativePath"\r\n\r\n${relativePath}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="sha256"\r\n\r\n${sha256}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="capturedAt"\r\n\r\n${capturedAt}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodeURIComponent(filename)}"\r\nContent-Type: application/octet-stream\r\n\r\n`;

  const epilogue = `\r\n--${boundary}--\r\n`;

  const preambleBuf = Buffer.from(preamble, 'utf8');
  const epilogueBuf = Buffer.from(epilogue, 'utf8');
  const totalLength = preambleBuf.length + fileSize + epilogueBuf.length;

  const requestOptions = {
    method: 'POST',
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': idempotencyKey,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(totalLength),
      'User-Agent': 'LabHub-InstrumentAgent/1.0',
      Connection: 'close',
    },
    timeout: 60000,
    agent: false,
  };

  return new Promise((resolve, reject) => {
    let fileStream = null;

    const req = transport.request(requestOptions, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        let parsedJson = null;
        try {
          parsedJson = JSON.parse(responseBody);
        } catch {
          parsedJson = { raw: responseBody };
        }

        let retryAfterSec;
        const retryHeader = res.headers['retry-after'];
        if (retryHeader) {
          const parsedInt = parseInt(retryHeader, 10);
          if (!Number.isNaN(parsedInt)) {
            retryAfterSec = parsedInt;
          } else {
            const dateMs = Date.parse(retryHeader);
            if (!Number.isNaN(dateMs)) {
              retryAfterSec = Math.max(1, Math.round((dateMs - Date.now()) / 1000));
            }
          }
        }

        resolve({
          statusCode: res.statusCode || 500,
          body: parsedJson,
          retryAfterSec,
        });
      });
    });

    req.on('error', (err) => {
      if (fileStream) fileStream.destroy();
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy(new Error('REQUEST_TIMEOUT: 서버 응답 시간 초과'));
    });

    try {
      // 1) 텍스트 필드 프리앰블 전송
      req.write(preambleBuf);

      // 2) 파일 데이터 스트리밍 전송 (메모리 버퍼링 금지, 읽기 전용)
      fileStream = fs.createReadStream(absolutePath, { flags: 'r', highWaterMark: 64 * 1024 });

      fileStream.on('error', (fileErr) => {
        req.destroy(fileErr);
        reject(fileErr);
      });

      fileStream.on('end', () => {
        // 3) 에필로그 전송 및 종료
        try {
          req.write(epilogueBuf);
          req.end();
        } catch (endErr) {
          reject(endErr);
        }
      });

      fileStream.pipe(req, { end: false });
    } catch (pipeErr) {
      req.destroy(pipeErr);
      reject(pipeErr);
    }
  });
}
