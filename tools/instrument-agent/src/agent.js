/**
 * @fileoverview InstrumentAgent 오케레이터 (스캔 주기, 동시성 제어, 재시도, 일시중지, 수명주기)
 */

import { StateStore } from './state.js';
import { scanWatchDirectory } from './scanner.js';
import { StabilityChecker } from './stability.js';
import { computeFileHashAndVerify, computeIdempotencyKey } from './hasher.js';
import { uploadFileStream } from './uploader.js';
import { logger } from './logger.js';

export class InstrumentAgent {
  /**
   * @param {Record<string, any>} config
   */
  constructor(config) {
    this.config = config;
    this.state = new StateStore(config.stateDir, config.instrumentId);
    this.stability = new StabilityChecker(config.stableSec);
    this.isRunning = false;
    this.scanTimer = null;
    this.activeUploads = 0;
    this.pauseCheckTimer = null;
    this.hasPermanentFailure = false;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    await this.state.init();
    this._initialized = true;
  }

  /**
   * 데몬 모드로 에이전트를 시작합니다.
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    await this.init();
    logger.info('InstrumentAgent가 시작되었습니다.', {
      instrumentId: this.config.instrumentId,
      serverUrl: this.config.serverUrl,
      concurrency: this.config.concurrency,
      scanIntervalSec: this.config.scanIntervalSec,
    });

    // 즉시 첫 스캔 실행
    this.scanAndProcess().catch((err) => {
      logger.error('스캔 중 예외 발생', { error: err.message });
    });

    // 주기적 스캔 타이머 등록
    this.scanTimer = setInterval(() => {
      if (!this.isRunning) return;
      this.scanAndProcess().catch((err) => {
        logger.error('스캔 중 예외 발생', { error: err.message });
      });
    }, this.config.scanIntervalSec * 1000);
  }

  /**
   * 에이전트를 안전하게 정지합니다 (진행 중인 업로드 완료 대기).
   */
  async stop() {
    this.isRunning = false;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.pauseCheckTimer) {
      clearTimeout(this.pauseCheckTimer);
      this.pauseCheckTimer = null;
    }

    // 진행 중인 업로드가 완료될 때까지 대기
    while (this.activeUploads > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    await this.state.save();
    logger.info('InstrumentAgent가 안전하게 정지되었습니다.');
  }

  /**
   * 단회 실행 (--once) 모드: 스캔 및 대기 큐 드레인 후 영구 실패 유무에 따라 boolean 반환
   * @returns {Promise<boolean>} 성공 시 true, 영구 실패 또는 처리 미완료 시 false
   */
  async runOnce() {
    await this.init();
    this.hasPermanentFailure = false;
    await this.scanAndProcess();

    // 진행 중인 모든 업로드가 끝날 때까지 대기
    while (this.activeUploads > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    await this.state.save();

    // 상태에 영구 실패(permanentlyFailed) 파일이 존재하거나 이번 실행 중 영구 실패가 발생했는지 확인
    let anyPermanentFailure = this.hasPermanentFailure;
    for (const rec of this.state.files.values()) {
      if (rec.permanentlyFailed) {
        anyPermanentFailure = true;
        break;
      }
    }

    return !anyPermanentFailure && !this.state.paused;
  }

  /**
   * 전체 감시 디렉토리를 스캔하고 적격 파일을 처리 큐에 투입합니다.
   */
  async scanAndProcess() {
    if (this.state.paused) {
      logger.warn('인증 오류로 인해 업로드가 일시 중지된 상태입니다. 재시도 전 대기 중입니다.', {
        reason: this.state.pauseReason,
      });
      return;
    }

    const discoveredFiles = [];
    const allRelativePaths = new Set();

    for (const watchItem of this.config.watch) {
      const files = await scanWatchDirectory(
        watchItem.path,
        watchItem.include,
        watchItem.exclude,
        this.config.maxFileSizeMb,
      );

      for (const f of files) {
        discoveredFiles.push(f);
        allRelativePaths.add(f.relativePath);
      }
    }

    // 상태 압축 (존재하지 않는 오래된 파일 정리)
    await this.state.compact(allRelativePaths);
    this.stability.cleanup(new Set(discoveredFiles.map((f) => f.absolutePath)));

    // 파일별 업로드 적격성 검토 및 큐 실행
    const queue = [];
    const now = Date.now();

    for (const file of discoveredFiles) {
      const rec = this.state.getFileRecord(file.relativePath);

      // 1) 영구 실패 처리된 파일: mtime과 크기가 같으면 재시도 안 함
      if (rec && rec.permanentlyFailed) {
        if (rec.mtimeMs === file.mtimeMs && rec.size === file.size) {
          continue;
        }
      }

      // 2) 이미 업로드 완료된 파일: mtime과 크기가 같으면 건너뜀
      if (rec && rec.status === 'uploaded') {
        if (rec.mtimeMs === file.mtimeMs && rec.size === file.size) {
          continue;
        }
      }

      // 3) 일시적 오류 백오프 대기 중인 파일
      if (rec && rec.nextRetryAt && now < rec.nextRetryAt) {
        continue;
      }

      // 4) 파일 안정성 검사 (stableSec 경과 및 읽기 오픈 가능 여부)
      const isStable = await this.stability.isStable(
        file.absolutePath,
        file.size,
        file.mtimeMs,
        now,
      );

      if (isStable) {
        queue.push(file);
      }
    }

    // 동시성(concurrency) 제한을 준수하며 병렬 처리
    await this.processQueueWithConcurrency(queue);
    await this.state.save();
  }

  /**
   * 지정된 동시성 제한 하에서 파일 큐를 처리합니다.
   * @param {Array<{ absolutePath: string, relativePath: string, size: number, mtimeMs: number }>} queue
   */
  async processQueueWithConcurrency(queue) {
    let index = 0;
    const concurrency = this.config.concurrency;

    const worker = async () => {
      while (index < queue.length) {
        if (this.state.paused) break;

        const file = queue[index++];
        if (!file) break;

        this.activeUploads++;
        try {
          await this.processSingleFile(file);
        } catch (err) {
          logger.error('파일 처리 중 예상치 못한 오류', { file: file.relativePath, error: err.message });
        } finally {
          this.activeUploads--;
        }
      }
    };

    const workers = [];
    const count = Math.min(concurrency, queue.length);
    for (let i = 0; i < count; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  /**
   * 단일 파일의 해시 계산 및 서버 업로드를 수행합니다.
   * @param {{ absolutePath: string, relativePath: string, size: number, mtimeMs: number }} file
   */
  async processSingleFile(file) {
    const { absolutePath, relativePath, size, mtimeMs } = file;
    const rec = this.state.getFileRecord(relativePath) || {};

    // 1) 스트리밍 SHA-256 계산 및 해싱 전후 파일 무결성 검증
    let sha256;
    try {
      sha256 = await computeFileHashAndVerify(absolutePath, { size, mtimeMs });
    } catch (err) {
      logger.warn('해시 계산 실패 또는 해싱 중 파일 변경 감지', { file: relativePath, error: err.message });
      return;
    }

    // 이미 업로드된 동일 내용의 파일인 경우 상태 갱신 후 건너뜀
    if (rec.status === 'uploaded' && rec.sha256 === sha256) {
      this.state.setFileRecord(relativePath, {
        mtimeMs,
        size,
        sha256,
        status: 'uploaded',
      });
      return;
    }

    // 2) 스트리밍 업로드 실행
    this.state.setFileRecord(relativePath, {
      mtimeMs,
      size,
      sha256,
      status: 'uploading',
    });

    let result;
    try {
      result = await uploadFileStream({
        serverUrl: this.config.serverUrl,
        apiKey: this.config.apiKey,
        instrumentId: this.config.instrumentId,
        relativePath,
        absolutePath,
        fileSize: size,
        mtimeMs,
        sha256,
      });
    } catch (netErr) {
      // 네트워크 전송 오류 (일시적)
      this.handleTransientError(relativePath, netErr.message, rec);
      return;
    }

    const { statusCode, body, retryAfterSec } = result;

    // 3) 응답 상태 코드별 분기 처리
    if (statusCode === 201 || (statusCode === 200 && body?.duplicate)) {
      // 성공 (저장 완료 또는 기존 중복 저장)
      logger.info('파일 업로드 완료', { file: relativePath, sha256, duplicate: !!body?.duplicate });
      this.state.setFileRecord(relativePath, {
        mtimeMs,
        size,
        sha256,
        status: 'uploaded',
        uploadedAt: new Date().toISOString(),
        permanentlyFailed: false,
        attempts: 0,
        lastError: null,
        nextRetryAt: null,
      });
      return;
    }

    if ([400, 413, 415].includes(statusCode)) {
      // 영구 거부 (잘못된 요청, 파일 크기 초과, 지원되지 않는 미디어)
      this.hasPermanentFailure = true;
      const reason = body?.message || `서버 거부 (HTTP ${statusCode})`;
      logger.error('파일 업로드가 영구 거부되었습니다.', { file: relativePath, statusCode, reason });
      this.state.setFileRecord(relativePath, {
        mtimeMs,
        size,
        sha256,
        status: 'failed',
        permanentlyFailed: true,
        lastError: reason,
        attempts: (rec.attempts || 0) + 1,
      });
      return;
    }

    if (statusCode === 422) {
      // 해시 불일치 (서버가 계산한 해시와 상이) -> 1회 재해싱 후 재시도
      const currentAttempts = rec.attempts || 0;
      if (currentAttempts === 0) {
        logger.warn('서버 해시 불일치(422) 감지. 1회 즉시 재시도합니다.', { file: relativePath });
        this.state.setFileRecord(relativePath, {
          attempts: 1,
          lastError: '서버 해시 불일치(422)',
        });
        // 재귀 1회 호출
        await this.processSingleFile(file);
      } else {
        this.hasPermanentFailure = true;
        logger.error('서버 해시 불일치 재시도 후에도 실패했습니다.', { file: relativePath });
        this.state.setFileRecord(relativePath, {
          status: 'failed',
          permanentlyFailed: true,
          attempts: currentAttempts + 1,
          lastError: '해시 불일치 재시도 실패(422)',
        });
      }
      return;
    }

    if (statusCode === 401 || statusCode === 403) {
      // 인증 실패 -> 모든 업로드 일시 중단
      const reason = `API 키 인증 실패 (HTTP ${statusCode}): ${body?.message || '권한 없음'}`;
      logger.error('API 키가 올바르지 않거나 권한이 없습니다. 모든 업로드를 일시 중지합니다.', {
        statusCode,
        reason,
      });
      this.state.paused = true;
      this.state.pauseReason = reason;
      await this.state.save();
      return;
    }

    // 408, 429, 5xx 등 일시적 오류
    const reason = body?.message || `서버 일시적 오류 (HTTP ${statusCode})`;
    this.handleTransientError(relativePath, reason, rec, retryAfterSec);
  }

  /**
   * 일시적 오류 발생 시 지수 백오프 및 재시도 일정을 설정합니다.
   * @param {string} relativePath
   * @param {string} errorReason
   * @param {Record<string, any>} rec
   * @param {number} [retryAfterSec]
   */
  handleTransientError(relativePath, errorReason, rec, retryAfterSec) {
    const attempts = (rec.attempts || 0) + 1;
    let delaySec;

    if (typeof retryAfterSec === 'number' && retryAfterSec > 0) {
      delaySec = retryAfterSec;
    } else {
      // 지수 백오프 + 지터 (최대 60초)
      const baseDelay = Math.min(60, Math.pow(2, Math.min(attempts, 6)));
      const jitter = Math.random() * 2;
      delaySec = Math.round(baseDelay + jitter);
    }

    const nextRetryAt = Date.now() + delaySec * 1000;
    logger.warn('업로드 일시적 오류 발생. 백오프 후 재시도 예정', {
      file: relativePath,
      attempts,
      delaySec,
      error: errorReason,
    });

    this.state.setFileRecord(relativePath, {
      status: 'failed',
      permanentlyFailed: false,
      attempts,
      lastError: errorReason,
      nextRetryAt,
    });
  }
}
