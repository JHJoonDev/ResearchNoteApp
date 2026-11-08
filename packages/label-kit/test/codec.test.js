import { describe, it, expect } from 'vitest';
import {
  encodeLabel,
  decodeLabel,
  VALID_TYPES,
  LABEL_PREFIX,
  MAX_PAYLOAD_LENGTH,
} from '../src/codec.js';

describe('codec - 고정 벡터 및 유효성 검증', () => {
  it('5종 유효 유형에 대한 encode 및 decode 왕복 일치성', () => {
    for (const type of VALID_TYPES) {
      const id = `ID_${type.toUpperCase()}-99`;
      const encoded = encodeLabel({ type, id });
      expect(encoded).toBe(`LH1:${type}:${id}`);

      const decoded = decodeLabel(encoded);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.type).toBe(type);
        expect(decoded.id).toBe(id);
      }
    }
  });

  it('식별자(ID) 경계값 검증 (1자 최소 길이 및 64자 최대 길이)', () => {
    const minId = 'a';
    const maxId = 'A'.repeat(64);

    const minEncoded = encodeLabel({ type: 'reagent', id: minId });
    expect(decodeLabel(minEncoded)).toEqual({ ok: true, type: 'reagent', id: minId });

    const maxEncoded = encodeLabel({ type: 'lot', id: maxId });
    expect(decodeLabel(maxEncoded)).toEqual({ ok: true, type: 'lot', id: maxId });
  });

  it('encodeLabel 잘못된 인자 시 명확한 에러 발생', () => {
    expect(() => encodeLabel(null)).toThrow(TypeError);
    expect(() => encodeLabel({ type: 'invalid_type', id: '123' })).toThrow(/유효하지 않은 레이블 유형/);
    expect(() => encodeLabel({ type: 'reagent', id: '' })).toThrow(/유효하지 않은 레이블 식별자/);
    expect(() => encodeLabel({ type: 'reagent', id: 'has space' })).toThrow(/유효하지 않은 레이블 식별자/);
    expect(() => encodeLabel({ type: 'reagent', id: 'A'.repeat(65) })).toThrow(/유효하지 않은 레이블 식별자/);
  });

  it('decodeLabel - URL 스키마 입력 차단', () => {
    const hostileUrls = [
      'https://labhub.example.org/reagent/123',
      'http://attacker.com/LH1:reagent:123',
      'javascript:alert(document.cookie)',
      'data:text/html,<script>evil()</script>',
      'ftp://files.example.com/data',
      'blob:https://example.com/uuid',
    ];

    for (const url of hostileUrls) {
      const res = decodeLabel(url);
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/URL|허용되지 않습니다/);
    }
  });

  it('decodeLabel - 세그먼트 개수 및 접두사 위반 차단', () => {
    expect(decodeLabel('LH1:reagent').ok).toBe(false); // 세그먼트 2개
    expect(decodeLabel('LH1:reagent:1:extra').ok).toBe(false); // 세그먼트 4개
    expect(decodeLabel('LH2:reagent:123').ok).toBe(false); // 접두사 오류
    expect(decodeLabel('QR:reagent:123').ok).toBe(false);
    expect(decodeLabel('::').ok).toBe(false);
  });

  it('decodeLabel - 비문자열 및 크기 초과 입력 차단', () => {
    expect(decodeLabel(null).ok).toBe(false);
    expect(decodeLabel(undefined).ok).toBe(false);
    expect(decodeLabel(12345).ok).toBe(false);
    expect(decodeLabel({}).ok).toBe(false);
    expect(decodeLabel('A'.repeat(MAX_PAYLOAD_LENGTH + 1)).ok).toBe(false);
  });
});

describe('codec - 시드 고정 무작위 퍼징 (2500건 예외 미발생 및 안전성 보장)', () => {
  // Mulberry32 결정론적 시드 고정 난수 생성기
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = mulberry32(20261108);

  const CHARSET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_:/?#[]@!$&\'()*+,;= \t\r\n가나다라마바사안녕한글漢字✨🚀\x00\x1f';

  function generateRandomString(maxLen) {
    const len = Math.floor(rng() * maxLen);
    let s = '';
    for (let i = 0; i < len; i++) {
      const idx = Math.floor(rng() * CHARSET.length);
      s += CHARSET[idx];
    }
    return s;
  }

  it('2500건의 임의 생성 입력에 대해 decodeLabel은 절대 예외를 던지지 않음', () => {
    const FUZZ_COUNT = 2500;
    let validCount = 0;
    let rejectedCount = 0;

    for (let i = 0; i < FUZZ_COUNT; i++) {
      let candidate;
      const mode = Math.floor(rng() * 4);

      if (mode === 0) {
        // 완전 무작위 문자열
        candidate = generateRandomString(120);
      } else if (mode === 1) {
        // LH1로 시작하지만 무작위 세그먼트
        candidate = `LH1:${generateRandomString(20)}:${generateRandomString(40)}`;
      } else if (mode === 2) {
        // 유효 형식 모방
        const type = VALID_TYPES[Math.floor(rng() * VALID_TYPES.length)];
        const id = generateRandomString(30).replace(/[^A-Za-z0-9_-]/g, 'x');
        candidate = `LH1:${type}:${id || 'item'}`;
      } else {
        // 특수 접두사 및 긴 문자열
        candidate = generateRandomString(300);
      }

      let res;
      expect(() => {
        res = decodeLabel(candidate);
      }).not.toThrow();

      expect(res).toBeDefined();
      expect(typeof res.ok).toBe('boolean');

      if (res.ok) {
        validCount++;
        expect(VALID_TYPES.includes(res.type)).toBe(true);
        expect(/^[A-Za-z0-9_-]{1,64}$/.test(res.id)).toBe(true);
        // 디코딩 성공 시 재인코딩 왕복 일치 확인
        const reEncoded = encodeLabel({ type: res.type, id: res.id });
        expect(decodeLabel(reEncoded)).toEqual(res);
      } else {
        rejectedCount++;
        expect(typeof res.reason).toBe('string');
        expect(res.reason.length).toBeGreaterThan(0);
      }
    }

    expect(validCount + rejectedCount).toBe(FUZZ_COUNT);
  });
});
