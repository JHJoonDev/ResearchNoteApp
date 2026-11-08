import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: path.join(root, '.env'), quiet: true });
export const dataDir = process.env.DATA_DIR || path.join(root, 'data');
export const uploadDir = path.join(dataDir, 'uploads');
export const sealDir = path.join(dataDir, 'seals');
mkdirSync(uploadDir, { recursive: true });
mkdirSync(sealDir, { recursive: true });
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.MONGO_URI || !process.env.JWT_SECRET || !process.env.CORS_ORIGIN)
)
  throw new Error('운영 환경에는 MONGO_URI, JWT_SECRET, CORS_ORIGIN이 필요합니다.');
if (process.env.NODE_ENV === 'production' && process.env.TIMESTAMP_PROVIDER === 'dev-local')
  throw new Error('dev-local 시점인증 공급자는 운영 환경에서 사용할 수 없습니다.');
if (process.env.NODE_ENV === 'production' && !process.env.DATA_ENCRYPTION_KEY)
  throw new Error('운영 환경에는 DATA_ENCRYPTION_KEY가 필요합니다.');
const keyPath = path.join(dataDir, '.jwt-key');
if (!process.env.JWT_SECRET && !existsSync(keyPath))
  writeFileSync(keyPath, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
export const jwtSecret = process.env.JWT_SECRET || readFileSync(keyPath, 'utf8');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET은 32자 이상이어야 합니다.');
