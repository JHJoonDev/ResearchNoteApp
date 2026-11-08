import { describe, it, expect } from 'vitest';
import { renderLabelSvg, xmlEscape, wrapOrTruncateText } from '../src/svg.js';
import { TEMPLATES } from '../src/templates.js';

describe('svg - XML 이스케이프 및 악의적 제목 보안 검증', () => {
  it('적대적 XSS/인젝션 페이로드가 포함된 타이틀의 안전한 XML 이스케이프', () => {
    const hostileTitle = `<script>alert('XSS')</script>" onclick="stealTokens()" & <img src=x onerror=evil()>`;
    const label = {
      type: 'reagent',
      id: 'RG-HOSTILE-01',
      title: hostileTitle,
      detailLines: ['<Line 1 & 2>', 'Quote: "Safe"'],
      ghsCodes: ['GHS02<script>'],
    };

    const svg = renderLabelSvg(label, '38x19');

    // 1) 비이스케이프 위험 태그 및 속성이 일체 존재하지 않아야 함
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('</script>');
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('onclick=');
    expect(svg).not.toContain('onerror=');

    // 2) XML 엔티티로 정상 치환되었는지 확인
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
  });

  it('CSP 안전성: script, foreignObject, 외부 url/참조 미포함 확인', () => {
    const label = {
      type: 'lot',
      id: 'LOT-2026-CSP',
      title: '에탄올 (Ethanol 99.9%)',
      detailLines: ['제조: 2026-11-01', '만료: 2027-11-01'],
      ghsCodes: ['GHS02', 'GHS07'],
    };

    const svg = renderLabelSvg(label, '50x25');

    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/@import/i);
    expect(svg).not.toMatch(/url\s*\(/i);
    expect(svg).not.toMatch(/xlink:href/i);
    expect(svg).not.toMatch(/href\s*=\s*["']https?:/i);
  });
});

describe('svg - 초소형 템플릿(25x10)에서의 한글 텍스트 오버플로 방지 검증', () => {
  it('25x10 초소형 규격에 100자 이상의 긴 한글 제목 주입 시 템플릿 경계 내 말줄임(...) 유지', () => {
    const extremelyLongKoreanTitle =
      '대한민국 약전 규격 고순도 정밀 분석용 특급 무수 에탄올 시약 매우 긴 명칭 오버플로 스트레스 테스트용 100자 텍스트 스트링';

    const label = {
      type: 'sample',
      id: 'SMP-OVERFLOW-01',
      title: extremelyLongKoreanTitle,
      detailLines: ['극소형 바이알 샘플 라인 1', '추가 세부 항목 라인 2'],
      ghsCodes: ['H225'],
    };

    const tmpl25x10 = TEMPLATES['25x10'];
    const svg = renderLabelSvg(label, '25x10');

    // 1) SVG 크기 선언 확인
    expect(svg).toContain('width="25mm"');
    expect(svg).toContain('height="10mm"');
    expect(svg).toContain('viewBox="0 0 25 10"');

    // 2) 말줄임표(…)가 포함되어 안전하게 잘렸는지 확인
    expect(svg).toContain('…');

    // 3) 모든 text 태그의 y 좌표가 템플릿 높이(10mm)를 초과하지 않는지 파싱 검증
    const textYMatches = Array.from(svg.matchAll(/<text[^>]+y="([0-9.]+)"/g)).map((m) =>
      parseFloat(m[1]),
    );
    expect(textYMatches.length).toBeGreaterThan(0);
    for (const y of textYMatches) {
      expect(y).toBeLessThanOrEqual(tmpl25x10.heightMm);
    }

    // 4) wrapOrTruncateText 단위 검증
    const lines = wrapOrTruncateText(extremelyLongKoreanTitle, 15, tmpl25x10.titleFontSizeMm, 1);
    expect(lines.length).toBe(1);
    expect(lines[0].endsWith('…')).toBe(true);
  });

  it('다양한 표준 템플릿(38x19, 50x25, 70x37) 렌더링 정상 동작', () => {
    for (const tmplName of ['38x19', '50x25', '70x37']) {
      const tmpl = TEMPLATES[tmplName];
      const svg = renderLabelSvg(
        {
          type: 'equipment',
          id: `EQ-${tmplName}`,
          title: `장비 EQ-${tmplName}`,
          detailLines: ['정기 교정 완료', '담당: 홍길동'],
        },
        tmplName,
      );

      expect(svg).toContain(`width="${tmpl.widthMm}mm"`);
      expect(svg).toContain(`height="${tmpl.heightMm}mm"`);
      expect(svg).toContain(`viewBox="0 0 ${tmpl.widthMm} ${tmpl.heightMm}"`);
      expect(svg).toContain('fill="#000000"'); // QR path
      expect(svg).toContain(`EQ-${tmplName}`);
    }
  });
});
