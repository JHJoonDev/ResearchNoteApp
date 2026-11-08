/**
 * @fileoverview @labhub/search-index 타입 정의 (JSDoc)
 */

/**
 * @typedef {'note' | 'reagent' | 'protocol'} RecordType
 */

/**
 * @typedef {Object} SearchRecord
 * @property {string} id 고유 식별자
 * @property {RecordType} type 문서 유형
 * @property {string} title 제목
 * @property {string} text 본문 평문
 * @property {string[]} tags 태그 목록
 * @property {string | null} projectId 소속 프로젝트 ID (개인 문서는 null)
 * @property {string} authorId 작성자 ID
 * @property {string} status 문서 상태
 * @property {boolean} isDeleted 삭제 여부 (소프트 삭제)
 * @property {string | number | Date} updatedAt 수정 일시
 */

/**
 * @typedef {Object} AdminAccess
 * @property {true} all 전체 접근 허용 여부
 */

/**
 * @typedef {Object} UserAccess
 * @property {false} [all]
 * @property {string[]} projectIds 사용자가 참여 중인 프로젝트 ID 목록
 * @property {string} authorId 사용자 자신의 작성자 ID
 */

/**
 * @typedef {AdminAccess | UserAccess} AccessContext
 */

/**
 * @typedef {Object} SearchFilters
 * @property {RecordType} [type] 특정 유형 필터
 * @property {string} [projectId] 특정 프로젝트 필터
 * @property {string} [authorId] 특정 작성자 필터
 * @property {string} [status] 특정 상태 필터
 * @property {string[]} [tags] 특정 태그 포함 필터
 * @property {boolean} [includeDeleted] 삭제된 문서 포함 여부 (기본값: false)
 */

/**
 * @typedef {Object} SearchOptions
 * @property {string} [q] 검색 질의어
 * @property {AccessContext} access 접근 제어 권한 컨텍스트 (필수)
 * @property {SearchFilters} [filters] 추가 필터 조건
 * @property {number} [page] 페이지 번호 (1부터 시작, 기본값: 1)
 * @property {number} [limit] 페이지 당 항목 수 (최대 100, 기본값: 20)
 */

/**
 * @typedef {Object} SearchResultItem
 * @property {string} id 레코드 ID
 * @property {RecordType} type 레코드 유형
 * @property {number} score 매칭 유사도 점수
 * @property {string} snippet 검색어 주변 발췌문 (하이라이트 포함)
 */

/**
 * @typedef {Object} SearchResult
 * @property {SearchResultItem[]} items 검색 결과 항목 목록
 * @property {number} total 권한 범위 내 일치하는 전체 레코드 수
 * @property {number} page 현재 페이지 번호
 * @property {number} limit 페이지 당 항목 수
 */

/**
 * @typedef {Object} SearchIndex
 * @property {() => Promise<void>} ensureSetup 멱등 인덱스 및 설정 초기화
 * @property {(records: SearchRecord[], options?: object) => Promise<void>} upsert 레코드 추가 및 갱신
 * @property {(ids: string[], options?: object) => Promise<void>} remove 레코드 삭제
 * @property {(options?: object) => Promise<void>} clear 전체 레코드 초기화
 * @property {(options: SearchOptions) => Promise<SearchResult>} search 권한 격리 검색 질의
 * @property {() => Promise<{ status: string, [key: string]: any }>} health 검색 엔진 상태 점검
 */

export {};
