/**
 * @fileoverview 메모리 기반 검색 엔진 어댑터 (MemorySearchIndex)
 */

import { validateAccess, checkRecordAccess } from '../access.js';
import { scoreRecord, createSnippet } from '../korean.js';

export class MemorySearchIndex {
  constructor(options = {}) {
    /** @type {Map<string, import('../types.js').SearchRecord>} */
    this.records = new Map();
    this.options = options;
  }

  /**
   * 멱등 설정 초기화
   * @returns {Promise<void>}
   */
  async ensureSetup() {
    // 메모리 어댑터는 추가 외부 설정이 필요 없음
  }

  /**
   * 레코드 목록 추가 또는 갱신
   * @param {import('../types.js').SearchRecord[]} records
   * @returns {Promise<void>}
   */
  async upsert(records) {
    if (!Array.isArray(records)) return;
    for (const record of records) {
      if (record && record.id) {
        this.records.set(String(record.id), {
          ...record,
          id: String(record.id),
          type: record.type || 'note',
          title: String(record.title || ''),
          text: String(record.text || ''),
          tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
          projectId: record.projectId ? String(record.projectId) : null,
          authorId: String(record.authorId || ''),
          status: String(record.status || ''),
          isDeleted: Boolean(record.isDeleted),
          updatedAt: record.updatedAt || new Date().toISOString(),
        });
      }
    }
  }

  /**
   * 지정된 ID 목록의 레코드 삭제
   * @param {string[]} ids
   * @returns {Promise<void>}
   */
  async remove(ids) {
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      this.records.delete(String(id));
    }
  }

  /**
   * 전체 인덱스 비우기
   * @returns {Promise<void>}
   */
  async clear() {
    this.records.clear();
  }

  /**
   * 권한 격리 검색 질의 수행
   *
   * @param {import('../types.js').SearchOptions} options
   * @returns {Promise<import('../types.js').SearchResult>}
   */
  async search({ q = '', access, filters = {}, page = 1, limit = 20 } = {}) {
    validateAccess(access);

    const safePage = Math.max(1, Number.isInteger(page) ? page : 1);
    const safeLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 20));

    const matched = [];

    for (const record of this.records.values()) {
      // 1. 엔진 쿼리 내부 접근 제어 및 필터 적용
      if (!checkRecordAccess(record, access, filters)) {
        continue;
      }

      // 2. 검색어 매칭 및 한국어/바이그램 스코어링
      const score = scoreRecord(record, q);
      if (score > 0) {
        matched.push({ record, score });
      }
    }

    // 3. 점수 내림차순, 동일 점수 시 updatedAt 내림차순 정렬
    matched.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const timeA = new Date(a.record.updatedAt).getTime() || 0;
      const timeB = new Date(b.record.updatedAt).getTime() || 0;
      return timeB - timeA;
    });

    const total = matched.length;
    const startIndex = (safePage - 1) * safeLimit;
    const paginated = matched.slice(startIndex, startIndex + safeLimit);

    const items = paginated.map(({ record, score }) => ({
      id: record.id,
      type: record.type,
      score,
      snippet: createSnippet(record.text, q),
    }));

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  /**
   * 검색 엔진 상태 점검
   * @returns {Promise<{ status: string, provider: string, count: number }>}
   */
  async health() {
    return {
      status: 'ok',
      provider: 'memory',
      count: this.records.size,
    };
  }
}
