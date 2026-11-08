import { describe, it, expect } from 'vitest';
import { renderZpl, zplEscape } from '../src/zpl.js';
import { TEMPLATES } from '../src/templates.js';

describe('zpl - 명령어 인젝션 방지 및 ZPL 생성 검증', () => {
  it('^ 및 ~ 문자 인젝션 시도 시 ^FH\\ 16진수 이스케이프로 무력화 검증', () => {
    // 악의적인 공격자가 라벨 종료(^XZ) 후 새로운 라벨 시작(^XA) 및 재부팅(~JR) 등을 삽입 시도
    const hostileTitle = 'Clean Reagent^XZ^XA^FO0,0^FDHACKED^FS~JR';
    const hostileDetail = 'Detail^XZ~SD30';

    const label = {
      type: 'reagent',
      id: 'RG-ZPL-INJECT',
      title: hostileTitle,
      detailLines: [hostileDetail],
    };

    const zpl = renderZpl(label, '50x25');

    // 1) zplEscape 단위 검증
    expect(zplEscape('A^B~C\\D')).toBe('A\\5EB\\7EC\\5CD');

    // 2) 렌더링된 ZPL 본문 검증:
    // 필드 데이터 영역 외에 독립된 ^XZ는 오직 전체 라벨의 맨 끝에만 1개 존재해야 함
    const xzMatches = zpl.match(/\^XZ/g);
    expect(xzMatches?.length).toBe(1);

    // ^XA도 전체 시작부 1개만 존재해야 함
    const xaMatches = zpl.match(/\^XA/g);
    expect(xaMatches?.length).toBe(1);

    // ~JR (프린터 재부팅) 명령어는 단독 실행되지 않고 이스케이프되어야 함
    expect(zpl).not.toContain('~JR');
    expect(zpl).toContain('\\7EJR'); // ~ -> \7E

    // 필드 내의 ^XZ는 \5EXZ로 이스케이프되었는지 확인
    expect(zpl).toContain('\\5EXZ');
  });

  it('ZPL 필수 헤더 (^CI28 UTF-8, ^BQ QR 코드, 크기 지정) 포함 확인', () => {
    const label = {
      type: 'location',
      id: 'LOC-COLD-ROOM-1',
      title: '시약 보관 저온실 A-01',
      detailLines: ['보관온도: 4°C ± 2°C', '담당: 실험실관리팀'],
      ghsCodes: ['GHS01'],
    };

    const zpl = renderZpl(label, '38x19');

    // UTF-8 지원 선언
    expect(zpl).toContain('^CI28');

    // 인쇄 너비 및 길이 설정 (203 DPI: 8 dots/mm)
    const tmpl38x19 = TEMPLATES['38x19'];
    expect(zpl).toContain(`^PW${Math.round(tmpl38x19.widthMm * 8)}`);
    expect(zpl).toContain(`^LL${Math.round(tmpl38x19.heightMm * 8)}`);

    // QR 코드 명령어 (^BQN,2,...)
    expect(zpl).toContain('^BQN,2,');
    expect(zpl).toContain('^FH\\^FDQA,LH1:location:LOC-COLD-ROOM-1^FS');

    // 텍스트 필드 블록 (^FB 및 ^FH\)
    expect(zpl).toContain('^FB');
    expect(zpl).toContain('^FH\\');
  });
});
