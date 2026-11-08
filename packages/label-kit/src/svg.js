/**
 * @fileoverview CSP-안전 SVG 레이블 렌더러 (XML 이스케이프, 한글 줄바꿈 및 오버플로 방지)
 */

import QRCode from 'qrcode';
import { encodeLabel } from './codec.js';
import { resolveTemplate } from './templates.js';

/**
 * XML 특수문자를 엔티티 코드로 이스케이프합니다.
 * @param {unknown} str
 * @returns {string}
 */
export function xmlEscape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 한글/한자(1.0 em)와 영문/숫자(~0.55 em)의 가중치를 고려하여 문자열의 시각적 너비(em 단위)를 계산합니다.
 * @param {string} text
 * @returns {number}
 */
export function estimateTextEmWidth(text) {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // 한글 음절, 한글 자모, CJK 통합 한자, 전각 문자 등은 전각(1.0 em)
    if (
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3130 && code <= 0x318f) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xff01 && code <= 0xff60)
    ) {
      width += 1.0;
    } else {
      width += 0.55;
    }
  }
  return width;
}

/**
 * 텍스트를 허용 너비(mm)와 폰트 크기(mm)에 맞추어 자동 줄바꿈 또는 말줄임(...) 처리합니다.
 * 템플릿 범위를 절대로 벗어나지(overflow) 않도록 보장합니다.
 *
 * @param {string} text
 * @param {number} availableWidthMm
 * @param {number} fontSizeMm
 * @param {number} maxLines
 * @returns {string[]} 잘려진 라인 배열
 */
export function wrapOrTruncateText(text, availableWidthMm, fontSizeMm, maxLines = 1) {
  if (!text || availableWidthMm <= 0 || fontSizeMm <= 0) return [];

  const maxEmPerLine = Math.max(1, availableWidthMm / fontSizeMm);
  const words = text.split(/(\s+)/); // 공백 보존 분할
  const lines = [];
  let currentLine = '';
  let currentEm = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;

    const wordEm = estimateTextEmWidth(word);

    // 단어 자체가 한 줄 허용치를 넘는 경우 (긴 한글 단어나 식별자) -> 글자 단위 분할
    if (wordEm > maxEmPerLine) {
      for (let c = 0; c < word.length; c++) {
        const char = word[c];
        const charEm = estimateTextEmWidth(char);
        if (currentEm + charEm > maxEmPerLine) {
          if (lines.length + 1 >= maxLines) {
            // 마지막 줄 말줄임 처리
            const ellipsis = '…';
            const ellipsisEm = 0.8;
            while (currentLine.length > 0 && currentEm + ellipsisEm > maxEmPerLine) {
              const lastChar = currentLine[currentLine.length - 1];
              currentEm -= estimateTextEmWidth(lastChar);
              currentLine = currentLine.slice(0, -1);
            }
            lines.push(currentLine + ellipsis);
            return lines;
          }
          lines.push(currentLine);
          currentLine = char;
          currentEm = charEm;
        } else {
          currentLine += char;
          currentEm += charEm;
        }
      }
      continue;
    }

    if (currentEm + wordEm > maxEmPerLine) {
      if (lines.length + 1 >= maxLines) {
        // 마지막 라인에서 오버플로 발생 -> 현재 라인 말줄임 처리
        const ellipsis = '…';
        const ellipsisEm = 0.8;
        while (currentLine.length > 0 && currentEm + ellipsisEm > maxEmPerLine) {
          const lastChar = currentLine[currentLine.length - 1];
          currentEm -= estimateTextEmWidth(lastChar);
          currentLine = currentLine.slice(0, -1);
        }
        lines.push(currentLine + ellipsis);
        return lines;
      }
      lines.push(currentLine.trimEnd());
      currentLine = word.trimStart();
      currentEm = estimateTextEmWidth(currentLine);
    } else {
      currentLine += word;
      currentEm += wordEm;
    }
  }

  if (currentLine.trim().length > 0 && lines.length < maxLines) {
    lines.push(currentLine.trimEnd());
  }

  return lines;
}

/**
 * QR 매트릭스를 순수 SVG path d 문자열로 변환합니다. (100% 벡터, CSP 안전)
 * @param {import('qrcode').QRCode} qr
 * @param {number} x
 * @param {number} y
 * @param {number} sizeMm
 * @returns {string} SVG <path> 요소 문자열
 */
export function qrToSvgPath(qr, x, y, sizeMm) {
  const moduleCount = qr.modules.size;
  const cellSize = sizeMm / moduleCount;
  let d = '';

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.modules.get(row, col)) {
        const cellX = (x + col * cellSize).toFixed(3);
        const cellY = (y + row * cellSize).toFixed(3);
        const cellW = cellSize.toFixed(3);
        d += `M${cellX},${cellY}h${cellW}v${cellW}h-${cellW}z `;
      }
    }
  }

  return `<path d="${d.trim()}" fill="#000000" shape-rendering="crispEdges"/>`;
}

/**
 * 표준 규격 레이블을 순수 CSP-safe SVG 문자열로 렌더링합니다.
 * 외부 리소스(@import, url(), script, foreignObject)가 없으며,
 * 모든 텍스트는 XML 이스케이프되고 한글 텍스트는 템플릿 범위를 절대 벗어나지 않습니다.
 *
 * @param {{
 *   type: 'reagent'|'lot'|'sample'|'equipment'|'location',
 *   id: string,
 *   title: string,
 *   detailLines?: string[],
 *   ghsCodes?: string[]|string,
 * }} label
 * @param {string | { widthMm: number, heightMm: number, marginMm?: number, titleFontSizeMm?: number, detailFontSizeMm?: number }} template
 * @returns {string} 완성된 SVG XML 문자열
 */
export function renderLabelSvg(label, template) {
  if (!label || typeof label !== 'object') {
    throw new TypeError('레이블 데이터 객체가 필요합니다.');
  }

  const tmpl = resolveTemplate(template);
  const payload = encodeLabel({ type: label.type, id: label.id });
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });

  const { widthMm, heightMm, marginMm, titleFontSizeMm, detailFontSizeMm } = tmpl;

  // 1) QR 코드 배치 (좌측 사각형 영역)
  const qrSizeMm = Math.max(5, Math.min(heightMm - 2 * marginMm, (widthMm - 2 * marginMm) * 0.45));
  const qrX = marginMm;
  const qrY = marginMm + (heightMm - 2 * marginMm - qrSizeMm) / 2;
  const qrPathSvg = qrToSvgPath(qr, qrX, qrY, qrSizeMm);

  // 2) 텍스트 영역 계산 (QR 우측)
  const gapMm = 1.0;
  const textX = qrX + qrSizeMm + gapMm;
  const textAvailableWidth = Math.max(5, widthMm - textX - marginMm);
  const textAvailableHeight = Math.max(4, heightMm - 2 * marginMm);

  // 3) GHS 코드 준비 (배열 정규화)
  let ghsText = '';
  if (label.ghsCodes) {
    if (Array.isArray(label.ghsCodes)) {
      ghsText = label.ghsCodes.filter(Boolean).join(' ');
    } else if (typeof label.ghsCodes === 'string') {
      ghsText = label.ghsCodes.trim();
    }
  }

  // 4) 타이틀 및 세부 라인 레이아웃 계산 (최대 템플릿 높이 내 제한)
  const lineHeightMultiplier = 1.25;
  const titleLineHeightMm = titleFontSizeMm * lineHeightMultiplier;
  const detailLineHeightMm = detailFontSizeMm * lineHeightMultiplier;

  // 타이틀 줄바꿈 계산 (소형 템플릿의 경우 1줄 또는 2줄)
  const maxTitleLines = heightMm <= 12 ? 1 : 2;
  const titleLines = wrapOrTruncateText(label.title || label.id, textAvailableWidth, titleFontSizeMm, maxTitleLines);

  // 세부 라인들 계산 (최대 3개 라인 + GHS 1라인)
  const remainingHeightForDetails = textAvailableHeight - titleLines.length * titleLineHeightMm;
  const maxDetailLineCount = Math.max(0, Math.floor(remainingHeightForDetails / detailLineHeightMm));

  const rawDetailLines = [];
  if (Array.isArray(label.detailLines)) {
    for (const line of label.detailLines) {
      if (typeof line === 'string' && line.trim()) {
        rawDetailLines.push(line.trim());
      }
    }
  }
  if (ghsText) {
    rawDetailLines.push(`[${ghsText}]`);
  }

  const detailLines = [];
  for (const rawLine of rawDetailLines) {
    if (detailLines.length >= maxDetailLineCount) break;
    const wrapped = wrapOrTruncateText(rawLine, textAvailableWidth, detailFontSizeMm, 1);
    if (wrapped.length > 0) {
      detailLines.push(wrapped[0]);
    }
  }

  // 5) SVG 텍스트 요소 생성
  let textElements = '';
  let currentY = marginMm + titleFontSizeMm * 0.9;

  // 제목 렌더링 (볼드)
  for (const tLine of titleLines) {
    textElements += `<text x="${textX.toFixed(2)}" y="${currentY.toFixed(2)}" font-family="-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="${titleFontSizeMm.toFixed(2)}mm" font-weight="bold" fill="#111827">${xmlEscape(tLine)}</text>\n`;
    currentY += titleLineHeightMm;
  }

  // 세부 항목 렌더링 (레귤러)
  currentY += 0.3; // 타이틀과 세부사항 사이 간격
  for (const dLine of detailLines) {
    if (currentY > heightMm - marginMm) break; // 절대 오버플로 방지
    const isGhs = dLine.startsWith('[') && dLine.endsWith(']');
    const fill = isGhs ? '#b91c1c' : '#4b5563';
    textElements += `<text x="${textX.toFixed(2)}" y="${currentY.toFixed(2)}" font-family="-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="${detailFontSizeMm.toFixed(2)}mm" font-weight="${isGhs ? '600' : 'normal'}" fill="${fill}">${xmlEscape(dLine)}</text>\n`;
    currentY += detailLineHeightMm;
  }

  // 6) 최종 SVG 문서 조립 (CSP-safe, standalone)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">`,
    `  <rect width="${widthMm}" height="${heightMm}" fill="#ffffff"/>`,
    `  <g id="qr-code">`,
    `    ${qrPathSvg}`,
    `  </g>`,
    `  <g id="label-text">`,
    `    ${textElements.trim()}`,
    `  </g>`,
    `</svg>`,
  ].join('\n');
}
