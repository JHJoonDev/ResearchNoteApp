/**
 * @fileoverview @labhub/search-index 메인 엔트리포인트
 */

import { MemorySearchIndex } from './adapters/memory.js';
import { MeiliSearchIndex } from './adapters/meilisearch.js';
import { noteToRecord } from './record.js';
import { validateAccess } from './access.js';

/**
 * 교체 가능한 검색 인덱스 인스턴스를 생성합니다.
 *
 * @param {Object} [options]
 * @param {'memory' | 'meilisearch'} [options.provider='memory'] 검색 엔진 공급자
 * @param {string} [options.host] Meilisearch 호스트 주소
 * @param {string} [options.apiKey] Meilisearch API 키
 * @param {string} [options.indexUid] 인덱스 UID
 * @returns {import('./types.js').SearchIndex}
 */
export function createSearchIndex(options = {}) {
  const provider = options.provider || 'memory';

  switch (provider) {
    case 'memory':
      return new MemorySearchIndex(options);

    case 'meilisearch':
      return new MeiliSearchIndex(options);

    default:
      throw new Error(`지원하지 않는 검색 엔진 공급자입니다: ${provider}`);
  }
}

export { noteToRecord, validateAccess, MemorySearchIndex, MeiliSearchIndex };
