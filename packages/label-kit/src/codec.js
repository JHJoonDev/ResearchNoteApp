/**
 * @fileoverview 레이블 페이로드 코덱 (브라우저 안전, Node 내장 모듈 일체 배제)
 * 형식: LH1:<type>:<id>
 */

export const LABEL_PREFIX = 'LH1';

/**
 * 지원되는 유효한 레이블 엔티티 유형 (총 5종)
 * @type {readonly ['reagent', 'lot', 'sample', 'equipment', 'location']}
 */
export const VALID_TYPES = Object.freeze([
  'reagent',
  'lot',
  'sample',
  'equipment',
  'location',
]);

/**
 * 식별자(ID) 정규식: 영문 대소문자, 숫자, 언더스코어, 하이픈 1~64자
 */
export const ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 페이로드 최대 허용 길이 (접두사 4 + 유형 최대 9 + 구분자 2 + ID 최대 64 = 79자, 여유분 포함 256자 제한)
 */
export const MAX_PAYLOAD_LENGTH = 256;

/**
 * 레이블 데이터를 표준 문자열 페이로드로 인코딩합니다.
 * @param {{ type: string, id: string }} data
 * @returns {string} 인코딩된 레이블 문자열 (예: "LH1:reagent:R-1234")
 * @throws {TypeError|Error} type 또는 id가 유효하지 않을 때
 */
export function encodeLabel(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('레이블 데이터 객체가 필요합니다.');
  }

  const { type, id } = data;

  if (typeof type !== 'string' || !VALID_TYPES.includes(type)) {
    throw new Error(
      `유효하지 않은 레이블 유형입니다: "${type}". 지원되는 유형: ${VALID_TYPES.join(', ')}`,
    );
  }

  if (typeof id !== 'string' || !ID_REGEX.test(id)) {
    throw new Error(
      `유효하지 않은 레이블 식별자(ID)입니다: "${id}". 영문, 숫자, '_', '-' 1~64자여야 합니다.`,
    );
  }

  return `${LABEL_PREFIX}:${type}:${id}`;
}

/**
 * 스캔되거나 입력된 문자열 페이로드를 안전하게 디코딩합니다.
 * 외부 입력은 신뢰할 수 없으므로 절대로 예외를 던지지 않고 { ok: false, reason }을 반환합니다.
 * URL, 크기 초과, 추가 세그먼트, 알 수 없는 유형 등을 철저히 거부합니다.
 *
 * @param {unknown} text
 * @returns {{ ok: true, type: 'reagent'|'lot'|'sample'|'equipment'|'location', id: string } | { ok: false, reason: string }}
 */
export function decodeLabel(text) {
  if (typeof text !== 'string') {
    return { ok: false, reason: '입력값이 문자열이 아닙니다.' };
  }

  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: '페이로드가 비어 있습니다.' };
  }

  if (trimmed.length > MAX_PAYLOAD_LENGTH) {
    return { ok: false, reason: `페이로드 길이가 최대 허용치(${MAX_PAYLOAD_LENGTH}자)를 초과했습니다.` };
  }

  // URL 스키마 포함 여부 검사 (웹 탐색 유도 등 악의적 페이로드 원천 차단)
  if (trimmed.includes('://') || /^(https?|ftp|file|javascript|data|blob|ws|wss):/i.test(trimmed)) {
    return { ok: false, reason: 'URL 스키마가 포함된 페이로드는 허용되지 않습니다.' };
  }

  // 정확히 콜론(:) 2개로 구분된 3개 세그먼트만 허용
  const segments = trimmed.split(':');
  if (segments.length !== 3) {
    return {
      ok: false,
      reason: `페이로드 세그먼트 개수(${segments.length}개)가 올바르지 않습니다. 정확히 3개(LH1:<type>:<id>)여야 합니다.`,
    };
  }

  const [prefix, type, id] = segments;

  if (prefix !== LABEL_PREFIX) {
    return { ok: false, reason: `알 수 없는 페이로드 접두사입니다: "${prefix}" (필수: ${LABEL_PREFIX}).` };
  }

  if (!VALID_TYPES.includes(type)) {
    return {
      ok: false,
      reason: `지원되지 않는 레이블 유형입니다: "${type}". 지원 유형: ${VALID_TYPES.join(', ')}.`,
    };
  }

  if (!ID_REGEX.test(id)) {
    return {
      ok: false,
      reason: `식별자(ID) 규격이 올바르지 않습니다: "${id}". [A-Za-z0-9_-]{1,64}만 허용됩니다.`,
    };
  }

  return {
    ok: true,
    type: /** @type {'reagent'|'lot'|'sample'|'equipment'|'location'} */ (type),
    id,
  };
}
