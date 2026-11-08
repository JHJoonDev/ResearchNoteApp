import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { dataDir } from '../config.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const scrypt = promisify(crypto.scrypt);
const b64url = (value) => Buffer.from(value).toString('base64url');
const fromB64url = (value) => Buffer.from(value, 'base64url');

export const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
export function sign(privateKey, data) {
  return crypto.sign(null, Buffer.isBuffer(data) ? data : Buffer.from(data), privateKey).toString('base64');
}
export function verify(publicKey, data, signature) {
  try {
    return crypto.verify(null, Buffer.isBuffer(data) ? data : Buffer.from(data), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

export async function derivePasswordKey(password, salt, params = {}) {
  const N = params.N || 16384;
  const r = params.r || 8;
  const p = params.p || 1;
  return scrypt(password, Buffer.from(salt, 'base64'), 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
}

export async function createSigningKey(userId, password) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateDer = pair.privateKey.export({ type: 'pkcs8', format: 'der' });
  const salt = crypto.randomBytes(16).toString('base64');
  const params = { N: 16384, r: 8, p: 1 };
  const key = await derivePasswordKey(password, salt, params);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedPrivateKey = Buffer.concat([cipher.update(privateDer), cipher.final()]);
  return {
    userId,
    keyId: crypto.randomUUID(),
    algorithm: 'Ed25519',
    publicKey,
    encryptedPrivateKey: Buffer.concat([iv, cipher.getAuthTag(), encryptedPrivateKey]).toString('base64'),
    kdf: { salt, params },
    active: true,
    createdAt: new Date(),
  };
}

export async function decryptSigningKey(record, password) {
  const packed = Buffer.from(record.encryptedPrivateKey, 'base64');
  const key = await derivePasswordKey(password, record.kdf.salt, record.kdf.params);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  const der = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
  return crypto.createPrivateKey({ key: der, type: 'pkcs8', format: 'der' });
}

export async function reencryptSigningKey(record, oldPassword, newPassword) {
  const privateKey = await decryptSigningKey(record, oldPassword);
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const salt = crypto.randomBytes(16).toString('base64');
  const params = { N: 16384, r: 8, p: 1 };
  const key = await derivePasswordKey(newPassword, salt, params);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(privateDer), cipher.final()]);
  record.encryptedPrivateKey = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  record.kdf = { salt, params };
  return record;
}

let dataKey;
export async function encryptionKey() {
  if (dataKey) return dataKey;
  const configured = process.env.DATA_ENCRYPTION_KEY;
  if (configured) {
    const parsed = Buffer.from(configured, 'base64');
    if (parsed.length !== 32) throw new Error('DATA_ENCRYPTION_KEY은 32바이트 base64 값이어야 합니다.');
    dataKey = parsed;
    return dataKey;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('운영 환경에는 DATA_ENCRYPTION_KEY가 필요합니다.');
  const filename = path.join(dataDir, '.data-encryption-key');
  try {
    dataKey = Buffer.from((await readFile(filename, 'utf8')).trim(), 'base64');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    dataKey = crypto.randomBytes(32);
    await writeFile(filename, dataKey.toString('base64'), { flag: 'wx', mode: 0o600 });
  }
  return dataKey;
}

export async function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', await encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export async function decryptSecret(value) {
  const data = Buffer.from(value, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', await encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

export function totpSecret(bytes = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const input = crypto.randomBytes(bytes);
  let bits = 0, value = 0, result = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

function decodeBase32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const char of secret.toUpperCase().replace(/=|\s/g, '')) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('TOTP 비밀 형식이 잘못되었습니다.');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotp(secret, now = Date.now()) {
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 30000);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (binary % 1000000).toString().padStart(6, '0');
}

export function verifyTotp(secret, code, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  for (let drift = -1; drift <= 1; drift++) if (generateTotp(secret, now + drift * 30000) === code) return true;
  return false;
}

export function randomToken() { return b64url(crypto.randomBytes(32)); }
