/**
 * @fileoverview 접근 제어(Access Control) 및 필터 인젝션 방어 모듈
 */

/**
 * 접근 권한 컨텍스트 유효성을 엄격하게 검증합니다.
 * 누락되거나 잘못된 형식이면 즉시 예외를 발생시킵니다.
 *
 * @param {import('./types.js').AccessContext} access
 * @throws {TypeError} access가 누락되었거나 형식이 올바르지 않은 경우
 */
export function validateAccess(access) {
  if (!access || typeof access !== 'object') {
    throw new TypeError('access context is required and must be an object');
  }

  if (access.all === true) {
    return;
  }

  if (!Array.isArray(access.projectIds) || typeof access.authorId !== 'string' || access.authorId.trim() === '') {
    throw new TypeError('access context must specify { all: true } or { projectIds: string[], authorId: string }');
  }
}

/**
 * Meilisearch 필터 문자열 내부의 문자열 리터럴을 이스케이프하여 인젝션을 방어합니다.
 *
 * @param {unknown} val
 * @returns {string} 이스케이프된 문자열 리터럴 (따옴표 제외)
 */
export function escapeMeiliString(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/**
 * Meilisearch 필터 표현식을 안전하게 구성합니다.
 *
 * @param {import('./types.js').AccessContext} access
 * @param {import('./types.js').SearchFilters} [filters]
 * @returns {string} Meilisearch filter 표현식
 */
export function buildMeiliFilter(access, filters = {}) {
  validateAccess(access);

  const andClauses = [];

  // 1. 소프트 삭제 필터
  if (!filters?.includeDeleted) {
    andClauses.push('isDeleted = false');
  }

  // 2. 접근 제어 권한 필터 (엔진 쿼리 내부 적용)
  if (access.all !== true) {
    const escapedAuthor = escapeMeiliString(access.authorId);
    if (access.projectIds.length === 0) {
      andClauses.push(`(projectId IS NULL AND authorId = "${escapedAuthor}")`);
    } else {
      const pList = access.projectIds.map((p) => `"${escapeMeiliString(p)}"`).join(', ');
      andClauses.push(`(projectId IN [${pList}] OR (projectId IS NULL AND authorId = "${escapedAuthor}"))`);
    }
  }

  // 3. 추가 조건 필터
  if (filters?.type) {
    andClauses.push(`type = "${escapeMeiliString(filters.type)}"`);
  }
  if (filters?.projectId !== undefined) {
    if (filters.projectId === null) {
      andClauses.push('projectId IS NULL');
    } else {
      andClauses.push(`projectId = "${escapeMeiliString(filters.projectId)}"`);
    }
  }
  if (filters?.authorId) {
    andClauses.push(`authorId = "${escapeMeiliString(filters.authorId)}"`);
  }
  if (filters?.status) {
    andClauses.push(`status = "${escapeMeiliString(filters.status)}"`);
  }
  if (Array.isArray(filters?.tags) && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      andClauses.push(`tags = "${escapeMeiliString(tag)}"`);
    }
  }

  return andClauses.join(' AND ');
}

/**
 * 메모리 어댑터용 레코드 접근 권한 및 필터 일치 여부를 검사합니다.
 *
 * @param {import('./types.js').SearchRecord} record
 * @param {import('./types.js').AccessContext} access
 * @param {import('./types.js').SearchFilters} [filters]
 * @returns {boolean}
 */
export function checkRecordAccess(record, access, filters = {}) {
  validateAccess(access);

  // 1. 소프트 삭제 검사
  if (!filters?.includeDeleted && record.isDeleted === true) {
    return false;
  }

  // 2. 접근 제어 검사
  if (access.all !== true) {
    const recordProjectId = record.projectId ? String(record.projectId) : null;
    const isProjectMember = recordProjectId !== null && access.projectIds.some((p) => String(p) === recordProjectId);
    const isPrivateAuthor = recordProjectId === null && String(record.authorId) === String(access.authorId);

    if (!isProjectMember && !isPrivateAuthor) {
      return false;
    }
  }

  // 3. 추가 필터 검사
  if (filters?.type && record.type !== filters.type) {
    return false;
  }
  if (filters?.projectId !== undefined) {
    const filterProj = filters.projectId ? String(filters.projectId) : null;
    const recProj = record.projectId ? String(record.projectId) : null;
    if (filterProj !== recProj) return false;
  }
  if (filters?.authorId && String(record.authorId) !== String(filters.authorId)) {
    return false;
  }
  if (filters?.status && record.status !== filters.status) {
    return false;
  }
  if (Array.isArray(filters?.tags) && filters.tags.length > 0) {
    const recordTags = Array.isArray(record.tags) ? record.tags.map(String) : [];
    for (const tag of filters.tags) {
      if (!recordTags.includes(String(tag))) return false;
    }
  }

  return true;
}
