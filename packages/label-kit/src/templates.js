/**
 * @fileoverview 레이블 및 시트 템플릿 규격 정의 (단위: mm)
 */

/**
 * 기본 레이블 규격 (최소 25x10, 38x19, 50x25, 70x37 포함)
 * @type {Record<string, { name: string, widthMm: number, heightMm: number, marginMm: number, qrScale: number, maxLines: number }>}
 */
export const TEMPLATES = Object.freeze({
  '25x10': Object.freeze({
    name: '25x10',
    widthMm: 25,
    heightMm: 10,
    marginMm: 0.8,
    qrScale: 0.8,
    maxLines: 2,
    titleFontSizeMm: 1.8,
    detailFontSizeMm: 1.3,
  }),
  '38x19': Object.freeze({
    name: '38x19',
    widthMm: 38,
    heightMm: 19,
    marginMm: 1.2,
    qrScale: 1.0,
    maxLines: 3,
    titleFontSizeMm: 2.4,
    detailFontSizeMm: 1.8,
  }),
  '50x25': Object.freeze({
    name: '50x25',
    widthMm: 50,
    heightMm: 25,
    marginMm: 1.5,
    qrScale: 1.2,
    maxLines: 4,
    titleFontSizeMm: 3.0,
    detailFontSizeMm: 2.2,
  }),
  '70x37': Object.freeze({
    name: '70x37',
    widthMm: 70,
    heightMm: 37,
    marginMm: 2.0,
    qrScale: 1.5,
    maxLines: 5,
    titleFontSizeMm: 4.0,
    detailFontSizeMm: 2.8,
  }),
});

/**
 * A4 용지(210 x 297 mm) 기준 표준 시트 레이아웃 템플릿
 */
export const SHEET_TEMPLATES = Object.freeze({
  '25x10': Object.freeze({
    name: '25x10',
    labelTemplate: TEMPLATES['25x10'],
    columns: 7,
    rows: 24,
    marginLeftMm: 10.5,
    marginTopMm: 12.5,
    gapXMm: 3.0,
    gapYMm: 1.5,
  }),
  '38x19': Object.freeze({
    name: '38x19',
    labelTemplate: TEMPLATES['38x19'],
    columns: 5,
    rows: 13,
    marginLeftMm: 7.5,
    marginTopMm: 18.5,
    gapXMm: 2.5,
    gapYMm: 2.0,
  }),
  '50x25': Object.freeze({
    name: '50x25',
    labelTemplate: TEMPLATES['50x25'],
    columns: 3,
    rows: 10,
    marginLeftMm: 20.0,
    marginTopMm: 18.5,
    gapXMm: 10.0,
    gapYMm: 2.5,
  }),
  '70x37': Object.freeze({
    name: '70x37',
    labelTemplate: TEMPLATES['70x37'],
    columns: 2,
    rows: 7,
    marginLeftMm: 25.0,
    marginTopMm: 14.0,
    gapXMm: 20.0,
    gapYMm: 3.0,
  }),
});

/**
 * 레이블 템플릿 식별자 또는 객체를 단일 정규화된 템플릿 객체로 해석합니다.
 * @param {string | { widthMm: number, heightMm: number, name?: string, marginMm?: number, maxLines?: number, titleFontSizeMm?: number, detailFontSizeMm?: number }} template
 * @returns {{ name: string, widthMm: number, heightMm: number, marginMm: number, maxLines: number, titleFontSizeMm: number, detailFontSizeMm: number }}
 */
export function resolveTemplate(template) {
  if (typeof template === 'string') {
    const found = TEMPLATES[template];
    if (!found) {
      throw new Error(`지원되지 않는 템플릿 이름입니다: "${template}". 지원 목록: ${Object.keys(TEMPLATES).join(', ')}`);
    }
    return found;
  }

  if (template && typeof template === 'object') {
    const widthMm = Number(template.widthMm);
    const heightMm = Number(template.heightMm);
    if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
      throw new Error('템플릿의 widthMm 및 heightMm은 양수여야 합니다.');
    }
    return {
      name: template.name || `${widthMm}x${heightMm}`,
      widthMm,
      heightMm,
      marginMm: typeof template.marginMm === 'number' ? template.marginMm : Math.min(widthMm, heightMm) * 0.08,
      maxLines: typeof template.maxLines === 'number' ? template.maxLines : 3,
      titleFontSizeMm: typeof template.titleFontSizeMm === 'number' ? template.titleFontSizeMm : Math.max(1.5, heightMm * 0.18),
      detailFontSizeMm: typeof template.detailFontSizeMm === 'number' ? template.detailFontSizeMm : Math.max(1.2, heightMm * 0.13),
    };
  }

  throw new TypeError('템플릿은 템플릿 명칭(string) 또는 widthMm/heightMm 객체여야 합니다.');
}

/**
 * 시트 템플릿 식별자 또는 설정 객체를 단일 정규화된 시트 레이아웃으로 해석합니다.
 * @param {string | Record<string, any>} sheet
 * @returns {Record<string, any>}
 */
export function resolveSheetTemplate(sheet) {
  if (typeof sheet === 'string') {
    const found = SHEET_TEMPLATES[sheet];
    if (!found) {
      throw new Error(`지원되지 않는 시트 템플릿입니다: "${sheet}". 지원 목록: ${Object.keys(SHEET_TEMPLATES).join(', ')}`);
    }
    return found;
  }

  if (sheet && typeof sheet === 'object') {
    const base = (sheet.name && SHEET_TEMPLATES[sheet.name]) || {};
    const labelTemplate = sheet.labelTemplate
      ? resolveTemplate(sheet.labelTemplate)
      : (base.labelTemplate || resolveTemplate(sheet.name || sheet));

    const columns = Number(sheet.columns || base.columns) || 1;
    const rows = Number(sheet.rows || base.rows) || 1;
    const marginLeftMm = Number(sheet.marginLeftMm ?? base.marginLeftMm) || 10;
    const marginTopMm = Number(sheet.marginTopMm ?? base.marginTopMm) || 10;
    const gapXMm = Number(sheet.gapXMm ?? base.gapXMm) || 2;
    const gapYMm = Number(sheet.gapYMm ?? base.gapYMm) || 2;

    return {
      name: sheet.name || base.name || 'custom',
      labelTemplate,
      columns,
      rows,
      marginLeftMm,
      marginTopMm,
      gapXMm,
      gapYMm,
      startOffset: sheet.startOffset ?? base.startOffset ?? 0,
      fontBytes: sheet.fontBytes || base.fontBytes,
    };
  }

  throw new TypeError('시트 템플릿은 템플릿 명칭(string) 또는 레이아웃 객체여야 합니다.');
}
