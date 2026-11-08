/**
 * @fileoverview Meilisearch 기반 검색 엔진 어댑터 (MeiliSearchIndex)
 */

import { Meilisearch } from 'meilisearch';
import { validateAccess, buildMeiliFilter } from '../access.js';

export class MeiliSearchIndex {
  /**
   * @param {Object} options
   * @param {string} [options.host]
   * @param {string} [options.apiKey]
   * @param {string} [options.indexUid]
   */
  constructor(options = {}) {
    this.host = options.host || process.env.MEILI_HOST || 'http://127.0.0.1:7700';
    this.apiKey = options.apiKey || process.env.MEILI_MASTER_KEY || '';
    this.indexUid = options.indexUid || 'labhub_search';

    this.client = new Meilisearch({
      host: this.host,
      apiKey: this.apiKey,
    });
    this.index = this.client.index(this.indexUid);
  }

  /**
   * 태스크 완료를 안전하게 대기하는 내부 헬퍼
   * @param {any} task
   * @private
   */
  async _waitForTask(task) {
    if (!task) return;
    const uid = typeof task === 'object' ? (task.taskUid ?? task.uid) : task;
    if (uid === undefined || uid === null) return;

    if (this.client.tasks && typeof this.client.tasks.waitForTask === 'function') {
      await this.client.tasks.waitForTask(uid);
    } else if (typeof this.client.waitForTask === 'function') {
      await this.client.waitForTask(uid);
    }
  }

  /**
   * 멱등 설정 초기화: 인덱스를 생성하고 필터/정렬 속성을 설정한 뒤 완료될 때까지 대기합니다.
   * @returns {Promise<void>}
   */
  async ensureSetup() {
    try {
      const task = await this.client.createIndex(this.indexUid, { primaryKey: 'id' });
      await this._waitForTask(task);
    } catch (e) {
      if (e.code !== 'index_already_exists') {
        try {
          await this.client.getIndex(this.indexUid);
        } catch {
          throw e;
        }
      }
    }

    this.index = this.client.index(this.indexUid);

    // 필터 가능, 정렬 가능, 검색 대상 속성 구성
    const task1 = await this.index.updateFilterableAttributes([
      'type',
      'projectId',
      'authorId',
      'status',
      'isDeleted',
      'tags',
    ]);
    const task2 = await this.index.updateSortableAttributes(['updatedAt']);
    const task3 = await this.index.updateSearchableAttributes(['title', 'text', 'tags']);

    await Promise.all([
      this._waitForTask(task1),
      this._waitForTask(task2),
      this._waitForTask(task3),
    ]);
  }

  /**
   * 레코드 목록 추가 또는 갱신
   * @param {import('../types.js').SearchRecord[]} records
   * @param {Object} [options]
   * @param {boolean} [options.wait=false] 비동기 태스크 완료 대기 여부
   * @returns {Promise<void>}
   */
  async upsert(records, { wait = false } = {}) {
    if (!Array.isArray(records) || records.length === 0) return;

    const normalizedRecords = records.map((r) => ({
      ...r,
      id: String(r.id),
      type: r.type || 'note',
      title: String(r.title || ''),
      text: String(r.text || ''),
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      projectId: r.projectId ? String(r.projectId) : null,
      authorId: String(r.authorId || ''),
      status: String(r.status || ''),
      isDeleted: Boolean(r.isDeleted),
      updatedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : Date.now(),
    }));

    const task = await this.index.addDocuments(normalizedRecords, { primaryKey: 'id' });
    if (wait) {
      await this._waitForTask(task);
    }
  }

  /**
   * 지정된 ID 목록의 레코드 삭제
   * @param {string[]} ids
   * @param {Object} [options]
   * @param {boolean} [options.wait=false]
   * @returns {Promise<void>}
   */
  async remove(ids, { wait = false } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const task = await this.index.deleteDocuments(ids.map(String));
    if (wait) {
      await this._waitForTask(task);
    }
  }

  /**
   * 전체 인덱스 비우기
   * @param {Object} [options]
   * @param {boolean} [options.wait=false]
   * @returns {Promise<void>}
   */
  async clear({ wait = false } = {}) {
    const task = await this.index.deleteAllDocuments();
    if (wait) {
      await this._waitForTask(task);
    }
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

    // 엔진 쿼리 내부 접근 제어 필터 표현식 생성 (인젝션 방어 적용)
    const filterExpr = buildMeiliFilter(access, filters);

    const searchParams = {
      filter: filterExpr || undefined,
      page: safePage,
      hitsPerPage: safeLimit,
      attributesToHighlight: ['title', 'text'],
      attributesToCrop: ['text'],
      cropLength: 30,
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      sort: ['updatedAt:desc'],
    };

    const res = await this.index.search(q, searchParams);

    const items = res.hits.map((hit) => ({
      id: String(hit.id),
      type: hit.type || 'note',
      score: hit._rankingScore ?? 1,
      snippet: hit._formatted?.text || hit.text || '',
    }));

    const total = res.totalHits ?? res.estimatedTotalHits ?? res.hits.length;

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  /**
   * 검색 엔진 상태 점검
   * @returns {Promise<{ status: string, provider: string, [key: string]: any }>}
   */
  async health() {
    try {
      const res = await this.client.health();
      return {
        status: res.status === 'available' ? 'ok' : res.status,
        provider: 'meilisearch',
      };
    } catch (e) {
      return {
        status: 'down',
        provider: 'meilisearch',
        error: e.message,
      };
    }
  }
}
