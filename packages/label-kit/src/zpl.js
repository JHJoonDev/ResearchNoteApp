/**
 * @fileoverview ZPL (Zebra Programming Language) 레이블 렌더러
 * UTF-8 (^CI28) 지원, ^BQ QR 코드, ^ 및 ~ 인젝션 차단 (^FH\ 16진수 이스케이프)
 */

import { encodeLabel } from './codec.js';
import { resolveTemplate } from './templates.js';

/**
 * ZPL 명령어 인젝션(^, ~, \)을 차단하기 위해 16진수(^FH\) 코드로 안전하게 이스케이프합니다.
 * @param {unknown} text
 * @returns {string}
 */
export function zplEscape(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\\/g, '\\5C')
    .replace(/\^/g, '\\5E')
    .replace(/~/g, '\\7E')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * 레이블 데이터를 Zebra 감열식 프린터용 ZPL 문자열로 렌더링합니다.
 * 203 DPI (8 dots/mm) 기준이며, UTF-8(^CI28) 및 인젝션 방지가 적용됩니다.
 *
 * @param {{
 *   type: 'reagent'|'lot'|'sample'|'equipment'|'location',
 *   id: string,
 *   title: string,
 *   detailLines?: string[],
 *   ghsCodes?: string[]|string,
 * }} label
 * @param {string | { widthMm: number, heightMm: number }} template
 * @param {{ dpi?: 203|300 }} [options]
 * @returns {string} 완성된 ZPL 명령어 문자열
 */
export function renderZpl(label, template, options = {}) {
  if (!label || typeof label !== 'object') {
    throw new TypeError('레이블 데이터 객체가 필요합니다.');
  }

  const tmpl = resolveTemplate(template);
  const payload = encodeLabel({ type: label.type, id: label.id });

  const dotsPerMm = options.dpi === 300 ? 12 : 8; // 기본 203 DPI (8 dots/mm)
  const widthDots = Math.round(tmpl.widthMm * dotsPerMm);
  const heightDots = Math.round(tmpl.heightMm * dotsPerMm);
  const marginDots = Math.round(tmpl.marginMm * dotsPerMm);

  // QR 코드 배율 계산 (203 DPI 기준: 배율 1~10)
  // ^BQN,2,{scale}에서 scale은 1~10 (보통 2~5)
  const qrScale = Math.max(2, Math.min(6, Math.floor((tmpl.heightMm - 2 * tmpl.marginMm) / 5)));
  const qrX = marginDots;
  const qrY = marginDots;

  // 텍스트 영역 계산 (QR 크기 고려)
  // QR 버전 2~3 기준 대략 25~29 모듈 * scale
  const approxQrDots = (25 + 4) * qrScale;
  const textX = qrX + approxQrDots + Math.round(2 * dotsPerMm);
  const textMaxW = Math.max(50, widthDots - textX - marginDots);

  // 폰트 크기 계산 (도트 단위)
  const titleFontH = Math.max(18, Math.round(tmpl.titleFontSizeMm * dotsPerMm * 1.1));
  const titleFontW = Math.max(12, Math.round(titleFontH * 0.7));

  const detailFontH = Math.max(14, Math.round(tmpl.detailFontSizeMm * dotsPerMm * 1.1));
  const detailFontW = Math.max(10, Math.round(detailFontH * 0.7));

  const zplLines = [
    '^XA',
    '^CI28', // UTF-8 인코딩 지정
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    '^LH0,0',
    // QR 코드 출력 (^BQN,2,{scale}^FDQA,{payload}^FS)
    // QR 페이로드 내 ^, ~ 인젝션도 방지
    `^FO${qrX},${qrY}^BQN,2,${qrScale}^FH\\^FDQA,${zplEscape(payload)}^FS`,
  ];

  let currentY = marginDots + 4;

  // 1) 제목 필드 출력 (^A0N 또는 기본 한글 폰트 대응)
  const escapedTitle = zplEscape(label.title || label.id);
  // ^FB{width},{maxLines},{space},{align} (텍스트 박스 자동 줄바꿈)
  const maxTitleLines = tmpl.heightMm <= 12 ? 1 : 2;
  zplLines.push(
    `^FO${textX},${currentY}^A0N,${titleFontH},${titleFontW}^FB${textMaxW},${maxTitleLines},2,L^FH\\^FD${escapedTitle}^FS`,
  );
  currentY += titleFontH * maxTitleLines + 4;

  // 2) 세부 라인들 출력
  const rawDetails = [];
  if (Array.isArray(label.detailLines)) {
    for (const d of label.detailLines) {
      if (typeof d === 'string' && d.trim()) rawDetails.push(d.trim());
    }
  }

  let ghsText = '';
  if (label.ghsCodes) {
    if (Array.isArray(label.ghsCodes)) ghsText = label.ghsCodes.filter(Boolean).join(' ');
    else if (typeof label.ghsCodes === 'string') ghsText = label.ghsCodes.trim();
  }
  if (ghsText) {
    rawDetails.push(`[${ghsText}]`);
  }

  for (const detail of rawDetails) {
    if (currentY + detailFontH > heightDots - marginDots) break;
    const escapedDetail = zplEscape(detail);
    zplLines.push(
      `^FO${textX},${currentY}^A0N,${detailFontH},${detailFontW}^FB${textMaxW},1,0,L^FH\\^FD${escapedDetail}^FS`,
    );
    currentY += detailFontH + 3;
  }

  zplLines.push('^XZ');

  return zplLines.join('\n');
}
