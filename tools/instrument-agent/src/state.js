/**
 * @fileoverview 원자적 파일 상태 저장소 (원자적 쓰기, 파일 손상 복구, 압축 지원)
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export class StateStore {
  /**
   * @param {string} stateDir
   * @param {string} instrumentId
   */
  constructor(stateDir, instrumentId) {
    this.stateDir = path.resolve(stateDir);
    this.instrumentId = instrumentId;
    this.stateFilePath = path.join(this.stateDir, `agent-state-${this.sanitizeId(instrumentId)}.json`);
    /** @type {Map<string, Record<string, any>>} */
    this.files = new Map();
    this.paused = false;
    this.pauseReason = null;
    this.lastCleanedAt = Date.now();
  }

  sanitizeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * 상태 저장소를 초기화하고 디스크에서 상태를 로드합니다.
   */
  async init() {
    await fs.promises.mkdir(this.stateDir, { recursive: true });
    await this.load();
  }

  /**
   * 디스크로부터 상태 파일을 안전하게 로드합니다.
   * 파일이 손상된 경우 백업을 생성하고 안전하게 복구합니다.
   */
  async load() {
    this.files.clear();

    if (!fs.existsSync(this.stateFilePath)) {
      return;
    }

    let rawData;
    try {
      rawData = await fs.promises.readFile(this.stateFilePath, 'utf8');
      if (!rawData.trim()) {
        return;
      }
      const parsed = JSON.parse(rawData);

      if (parsed && typeof parsed === 'object') {
        if (parsed.files && typeof parsed.files === 'object') {
          for (const [key, value] of Object.entries(parsed.files)) {
            if (value && typeof value === 'object') {
              this.files.set(key, value);
            }
          }
        }
        if (typeof parsed.paused === 'boolean') {
          this.paused = parsed.paused;
          this.pauseReason = parsed.pauseReason || null;
        }
      }
    } catch (err) {
      // 상태 파일 손상 감지
      const corruptBackup = `${this.stateFilePath}.corrupt.${Date.now()}`;
      logger.error('손상된 상태 파일을 감지했습니다. 백업을 보존하고 상태를 복구합니다.', {
        error: err.message,
        backupPath: corruptBackup,
      });

      try {
        if (rawData !== undefined) {
          await fs.promises.writeFile(corruptBackup, rawData, 'utf8');
        } else if (fs.existsSync(this.stateFilePath)) {
          await fs.promises.copyFile(this.stateFilePath, corruptBackup);
        }
      } catch (backupErr) {
        logger.error('손상 상태 파일 백업 실패', { error: backupErr.message });
      }

      this.files.clear();
      this.paused = false;
      this.pauseReason = null;
    }
  }

  /**
   * 상태를 디스크에 원자적으로 저장합니다 (임시 파일 생성 후 rename).
   */
  async save() {
    await fs.promises.mkdir(this.stateDir, { recursive: true });

    const dataObj = {
      version: 1,
      instrumentId: this.instrumentId,
      updatedAt: new Date().toISOString(),
      paused: this.paused,
      pauseReason: this.pauseReason,
      files: Object.fromEntries(this.files.entries()),
    };

    const serialized = JSON.stringify(dataObj, null, 2);
    const tempFilePath = `${this.stateFilePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;

    // 임시 파일 쓰기 및 fsync
    const fh = await fs.promises.open(tempFilePath, 'w');
    await fh.writeFile(serialized, 'utf8');
    await fh.sync();
    await fh.close();

    // 원자적 교체 (Windows 호환)
    try {
      await fs.promises.rename(tempFilePath, this.stateFilePath);
    } catch (err) {
      // 윈도우에서 목적지 파일이 존재할 경우 rename이 실패할 수 있으므로 fallback
      if (fs.existsSync(this.stateFilePath)) {
        await fs.promises.unlink(this.stateFilePath);
      }
      await fs.promises.rename(tempFilePath, this.stateFilePath);
    }
  }

  getFileRecord(relativePath) {
    return this.files.get(relativePath) || null;
  }

  setFileRecord(relativePath, record) {
    const existing = this.files.get(relativePath) || {};
    this.files.set(relativePath, {
      ...existing,
      ...record,
      relativePath,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * 더 이상 존재하지 않는 파일이나 오래된 실패 기록을 정리하여 상태가 무한히 커지는 것을 방지합니다.
   * @param {Set<string>} currentRelativePaths
   */
  async compact(currentRelativePaths) {
    let changed = false;
    const now = Date.now();
    const MAX_FAILED_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30일

    for (const [relPath, record] of this.files.entries()) {
      // 현재 감시 디렉토리에 더 이상 존재하지 않는 파일 처리
      if (!currentRelativePaths.has(relPath)) {
        const lastUpdated = new Date(record.updatedAt || 0).getTime();
        // 삭제된 파일이 실패 상태였거나 30일 이상 지난 경우 정리
        if (record.status !== 'uploaded' || now - lastUpdated > MAX_FAILED_AGE_MS) {
          this.files.delete(relPath);
          changed = true;
        }
      }
    }

    if (changed) {
      await this.save();
    }
  }

  /**
   * 대기/처리 상태 집계 요약을 반환합니다 (--status CLI용).
   */
  getSummary() {
    let pending = 0;
    let uploaded = 0;
    let failed = 0;
    let uploading = 0;

    for (const rec of this.files.values()) {
      if (rec.status === 'uploaded') uploaded++;
      else if (rec.status === 'failed') failed++;
      else if (rec.status === 'uploading') uploading++;
      else pending++;
    }

    return {
      instrumentId: this.instrumentId,
      paused: this.paused,
      pauseReason: this.pauseReason,
      totalTracked: this.files.size,
      uploaded,
      failed,
      uploading,
      pending,
    };
  }
}
