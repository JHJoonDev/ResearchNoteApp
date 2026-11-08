import crypto from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { dataDir } from '../../config.js';

const execFile = promisify(execFileCallback);

const derLen = (n) => {
  if (n < 128) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 255); n >>>= 8; }
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
};
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const oid = (value) => {
  const parts = value.split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    let n = part;
    const encoded = [n & 127];
    while ((n = Math.floor(n / 128))) encoded.unshift((n & 127) | 128);
    bytes.push(...encoded);
  }
  return tlv(0x06, Buffer.from(bytes));
};
const integer = (value) => {
  let n = BigInt(value);
  const bytes = [];
  do { bytes.unshift(Number(n & 255n)); n >>= 8n; } while (n > 0n);
  if (bytes[0] & 128) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
};

function parse(buffer, offset = 0) {
  if (offset + 2 > buffer.length) throw new Error('TSA 응답 ASN.1이 잘렸습니다.');
  const start = offset;
  const tag = buffer[offset++];
  let length = buffer[offset++];
  if (length & 128) {
    const size = length & 127;
    if (!size || size > 4 || offset + size > buffer.length) throw new Error('TSA 응답 길이가 잘못되었습니다.');
    length = 0;
    for (let i = 0; i < size; i++) length = length * 256 + buffer[offset++];
  }
  const bodyStart = offset;
  const end = bodyStart + length;
  if (end > buffer.length) throw new Error('TSA 응답 ASN.1이 잘렸습니다.');
  const constructed = (tag & 0x20) !== 0;
  const children = [];
  if (constructed) while (offset < end) { const child = parse(buffer, offset); children.push(child.node); offset = child.end; }
  return { node: { tag, body: buffer.subarray(bodyStart, end), raw: buffer.subarray(start, end), children }, end };
}
const asn1 = (buffer) => { const result = parse(Buffer.from(buffer)); if (result.end !== buffer.length) throw new Error('TSA 응답에 불필요한 데이터가 있습니다.'); return result.node; };
const readInt = (node) => { if (!node || node.tag !== 0x02) throw new Error('TSA 정수 필드가 없습니다.'); return BigInt(`0x${node.body.toString('hex') || '0'}`); };
const readOid = (node) => {
  if (!node || node.tag !== 0x06) throw new Error('TSA 알고리즘 식별자가 없습니다.');
  const b = [...node.body]; const first = b.shift(); const out = [Math.floor(first / 40), first % 40]; let n = 0;
  for (const byte of b) { n = n * 128 + (byte & 127); if (!(byte & 128)) { out.push(n); n = 0; } }
  if (n) throw new Error('TSA OID가 잘렸습니다.');
  return out.join('.');
};
const readString = (node) => node?.body?.toString('ascii') || '';
const invalidResponse = (message) => Object.assign(new Error(message), { code: 'TSA_INVALID_RESPONSE' });
const derInteger = (n) => integer(n);
function createRequest(hashHex, nonce, policyOid) {
  const imprint = seq(seq(oid('2.16.840.1.101.3.4.2.1'), tlv(0x05, Buffer.alloc(0))), tlv(0x04, Buffer.from(hashHex, 'hex')));
  return seq(integer(1), imprint, ...(policyOid ? [oid(policyOid)] : []), derInteger(nonce), tlv(0x01, Buffer.from([0xff])));
}
function parseInfo(info) {
  if (info.tag !== 0x30 || info.children.length < 5) throw new Error('RFC 3161 TSTInfo 형식이 잘못되었습니다.');
  const [version, policy, imprint, serial, genTime] = info.children;
  const nonce = info.children.slice(5).find((item) => item.tag === 0x02);
  const tsa = info.children.slice(5).find((item) => item.tag === 0xa0);
  if (readInt(version) !== 1n || imprint?.tag !== 0x30 || imprint.children.length < 2) throw new Error('RFC 3161 TSTInfo 필드가 잘못되었습니다.');
  const algorithm = readOid(imprint.children[0].children[0]);
  const hash = imprint.children[1].body.toString('hex');
  const serialNumber = serial?.body?.toString('hex').replace(/^00/, '') || '';
  const timeText = readString(genTime);
  const date = new Date(`${timeText.slice(0, 4)}-${timeText.slice(4, 6)}-${timeText.slice(6, 8)}T${timeText.slice(8, 10)}:${timeText.slice(10, 12)}:${timeText.slice(12, 14)}.${(timeText.match(/\.(\d+)/)?.[1] || '').padEnd(3, '0').slice(0, 3)}Z`);
  return { algorithm, hash, nonce: nonce ? readInt(nonce) : null, genTime: date, serial: serialNumber, tsaName: tsa?.children?.[0] ? readString(tsa.children[0]) : undefined };
}

function extractTimestampToken(token) {
  const root = asn1(token);
  if (root.tag !== 0x30 || root.children.length < 2 || readOid(root.children[0]) !== '1.2.840.113549.1.7.2') throw new Error('RFC 3161 CMS 토큰 형식이 잘못되었습니다.');
  const explicit = root.children[1];
  const signedData = explicit.children?.[0];
  const encapsulated = signedData?.children?.[2];
  const content = encapsulated?.children?.[1]?.children?.[0];
  if (!content || content.tag !== 0x04) throw new Error('RFC 3161 토큰에 TSTInfo가 없습니다.');
  return { info: parseInfo(asn1(content.body)), root };
}

export async function verifyCms(token, caPath, run = execFile) {
  if (!caPath) return { isTrusted: false };
  const dir = os.tmpdir();
  const input = path.join(dir, `labhub-ts-${crypto.randomUUID()}.der`);
  const output = path.join(dir, `labhub-ts-${crypto.randomUUID()}.der`);
  try {
    const parsed = asn1(token);
    const der = parsed.raw;
    await writeTmp(input, der);
    try {
      await run(process.env.OPENSSL_PATH || 'openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', input, '-CAfile', caPath, '-purpose', 'timestampsign', '-out', output], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    } catch (error) {
      throw invalidResponse(`RFC 3161 CMS 검증 실패: ${error.stderr || error.message || 'openssl 오류'}`);
    }
    return { isTrusted: true };
  } finally {
    await Promise.all([unlink(input).catch(() => {}), unlink(output).catch(() => {})]);
  }
}
// Uses the filesystem API asynchronously; separated for deterministic cleanup on Windows.
async function writeTmp(filename, data) { await writeFile(filename, data, { flag: 'wx' }); }

let localPair;
async function devKeyPair() {
  if (localPair) return localPair;
  const privatePath = path.join(dataDir, '.dev-local-tsa-private.pem');
  const publicPath = path.join(dataDir, '.dev-local-tsa-public.pem');
  try { localPair = { privateKey: await readFile(privatePath), publicKey: await readFile(publicPath) }; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const pair = crypto.generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
    await writeFile(privatePath, privateKey, { flag: 'wx', mode: 0o600 });
    await writeFile(publicPath, publicKey, { flag: 'wx', mode: 0o600 });
    localPair = { privateKey, publicKey };
  }
  return localPair;
}

function providerName() { return process.env.TIMESTAMP_PROVIDER || 'none'; }

export function getTimestampProvider(name = providerName()) {
  if (name === 'none') return { name, isTrusted: false, async request() { return { status: 'not_configured' }; }, async verify() { return { status: 'not_configured', isTrusted: false }; } };
  if (name === 'enote-portal') return { name, isTrusted: false, async request() { return { status: 'not_configured', lastError: '기관 신청 후 연계 명세가 필요합니다.' }; }, async verify() { return { status: 'not_configured', isTrusted: false }; } };
  if (name === 'dev-local') return {
    name, isTrusted: false,
    async request(sha256Hex) {
      if (process.env.NODE_ENV === 'production') throw new Error('dev-local 시점인증 공급자는 운영 환경에서 사용할 수 없습니다.');
      const pair = await devKeyPair();
      const payload = { sha256: sha256Hex, genTime: new Date().toISOString(), tsaName: 'dev-local', serial: crypto.randomBytes(8).toString('hex') };
      const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), pair.privateKey).toString('base64');
      return { status: 'granted', tokenBase64: Buffer.from(JSON.stringify({ payload, signature, publicKey: pair.publicKey.toString() })).toString('base64'), genTime: payload.genTime, tsaName: payload.tsaName, serial: payload.serial, isTrusted: false };
    },
    async verify(tokenBase64, sha256Hex) {
      try { const token = JSON.parse(Buffer.from(tokenBase64, 'base64').toString()); const data = Buffer.from(JSON.stringify(token.payload));
        return { status: token.payload.sha256 === sha256Hex && crypto.verify(null, data, token.publicKey, Buffer.from(token.signature, 'base64')) ? 'granted' : 'failed', genTime: token.payload.genTime, tsaName: token.payload.tsaName, serial: token.payload.serial, isTrusted: false };
      } catch { return { status: 'failed', isTrusted: false }; }
    },
  };
  if (name !== 'rfc3161') throw new Error(`알 수 없는 시점인증 공급자입니다: ${name}`);
  return rfc3161Provider();
}

function rfc3161Provider() {
  const caPath = process.env.TSA_CA_CERT;
  return {
    name: 'rfc3161', isTrusted: Boolean(caPath),
    async request(sha256Hex) {
      if (!process.env.TSA_URL) return { status: 'not_configured', lastError: 'TSA_URL이 설정되지 않았습니다.' };
      const nonce = BigInt(`0x${crypto.randomBytes(8).toString('hex')}`);
      const headers = { 'Content-Type': 'application/timestamp-query', Accept: 'application/timestamp-reply' };
      const init = { method: 'POST', headers, body: createRequest(sha256Hex, nonce, process.env.TSA_POLICY_OID), signal: AbortSignal.timeout(10000) };
      if (process.env.TSA_USERNAME || process.env.TSA_PASSWORD) headers.Authorization = `Basic ${Buffer.from(`${process.env.TSA_USERNAME || ''}:${process.env.TSA_PASSWORD || ''}`).toString('base64')}`;
      const response = await fetch(process.env.TSA_URL, init);
      if (!response.ok) throw new Error(`TSA HTTP 오류 (${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      let token, info, trust;
      try {
        const resp = asn1(bytes);
        if (resp.tag !== 0x30 || !resp.children.length) throw new Error('RFC 3161 응답 형식이 잘못되었습니다.');
        const status = Number(readInt(resp.children[0].children[0]));
        if (![0, 1].includes(status) || !resp.children[1]) throw new Error(`TSA 요청이 거부되었습니다 (${status}).`);
        token = resp.children[1].raw;
        ({ info } = extractTimestampToken(token));
        if (info.algorithm !== '2.16.840.1.101.3.4.2.1' || info.hash !== sha256Hex.toLowerCase() || info.nonce !== nonce) throw new Error('TSA 응답의 nonce 또는 messageImprint가 일치하지 않습니다.');
        trust = await verifyCms(token, caPath);
      } catch (error) {
        if (error.code === 'TSA_INVALID_RESPONSE') throw error;
        throw invalidResponse(error.message);
      }
      return { status: 'granted', tokenBase64: token.toString('base64'), genTime: info.genTime, tsaName: info.tsaName, serial: info.serial, isTrusted: trust.isTrusted };
    },
    async verify(tokenBase64, sha256Hex) {
      try {
        const token = Buffer.from(tokenBase64, 'base64'); const { info } = extractTimestampToken(token);
        if (info.algorithm !== '2.16.840.1.101.3.4.2.1' || info.hash !== sha256Hex.toLowerCase()) return { status: 'failed', isTrusted: false };
        const trust = await verifyCms(token, caPath);
        return { status: 'granted', genTime: info.genTime, tsaName: info.tsaName, serial: info.serial, isTrusted: trust.isTrusted };
      } catch { return { status: 'failed', isTrusted: false }; }
    },
  };
}

export function timestampRequestDer(sha256Hex, nonce, policyOid) { return createRequest(sha256Hex, nonce, policyOid); }
