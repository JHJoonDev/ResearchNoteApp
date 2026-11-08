/**
 * @fileoverview 파일 안정화 판정 모듈 (stableSec 유지 및 읽기 가능 여부 확인)
 */

import fs from 'node:fs';

export class StabilityChecker {
  /**
   * @param {number} stableSec
   */
  constructor(stableSec = 10) {
    this.stableSec = stableSec;
    /** @type {Map<string, { size: number, mtimeMs: number, lastChangedAt: number }>} */
    this.observations = new Map();
  }

  /**
   * 파일이 안정 상태에 도달했는지 확인합니다.
   * 1. 파일의 크기와 mtime이 변경되지 않은 상태로 stableSec 이상 유지되어야 함
   * 2. 읽기 모드('r')로 정상 오픈 가능해야 함
   *
   * @param {string} filePath
   * @param {number} currentSize
   * @param {number} currentMtimeMs
   * @param {number} [now]
   * @returns {Promise<boolean>}
   */
  async isStable(filePath, currentSize, currentMtimeMs, now = Date.now()) {
    const minMtimeAgeMs = this.stableSec * 1000;

    // mtime 자체가 stableSec보다 최근이면 아직 기록 중일 가능성
    if (now - currentMtimeMs < minMtimeAgeMs) {
      return false;
    }

    const prev = this.observations.get(filePath);

    if (!prev) {
      // 최초 관측 기록
      this.observations.set(filePath, {
        size: currentSize,
        mtimeMs: currentMtimeMs,
        firstObservedAt: now,
      });
      // 이미 mtime이 stableSec보다 충분히 이전이면 바로 읽기 테스트
      return this.canOpenForReading(filePath);
    }

    // 파일 크기가 변경되었거나 더 최신 mtime으로 갱신된 경우 불안정 판정
    if (prev.size !== currentSize || currentMtimeMs > prev.mtimeMs) {
      this.observations.set(filePath, {
        size: currentSize,
        mtimeMs: currentMtimeMs,
        firstObservedAt: now,
      });
      return false;
    }

    // 크기와 mtime이 불변이고 stableSec 이상 경과했으므로 읽기 가능 여부 확인
    return this.canOpenForReading(filePath);
  }

  /**
   * 파일이 읽기 전용으로 오픈 가능한지 확인합니다. (파일 수정 절대 금지)
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  async canOpenForReading(filePath) {
    let handle;
    try {
      handle = await fs.promises.open(filePath, 'r');
      return true;
    } catch {
      return false;
    } finally {
      if (handle) {
        await handle.close();
      }
    }
  }

  cleanup(activePaths) {
    for (const key of this.observations.keys()) {
      if (!activePaths.has(key)) {
        this.observations.delete(key);
      }
    }
  }
}
