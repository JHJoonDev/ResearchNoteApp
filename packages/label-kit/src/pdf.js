/**
 * @fileoverview A4 라벨 시트 PDF 렌더러 (@labhub/label-kit/pdf)
 * pdf-lib 기반, 사용자 제공 한글 폰트 바이트 임베딩, 다중 페이지 및 startOffset(잔여 시트 재사용) 지원
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { encodeLabel } from './codec.js';
import { resolveSheetTemplate, SHEET_TEMPLATES } from './templates.js';
import { wrapOrTruncateText } from './svg.js';

// A4 규격 (210 x 297 mm)을 PDF 포인트(1 pt = 1/72 inch, 1 mm = 72 / 25.4 pt)로 환산
const MM_TO_PT = 72 / 25.4;
const A4_WIDTH_PT = 210 * MM_TO_PT; // ~595.28 pt
const A4_HEIGHT_PT = 297 * MM_TO_PT; // ~841.89 pt

/**
 * 라벨 목록과 시트 템플릿을 기반으로 인쇄용 A4 PDF 바이트 배열을 생성합니다.
 *
 * @param {Array<{
 *   type: 'reagent'|'lot'|'sample'|'equipment'|'location',
 *   id: string,
 *   title: string,
 *   detailLines?: string[],
 *   ghsCodes?: string[]|string,
 * }>} labels
 * @param {string | {
 *   name?: string,
 *   labelTemplate?: any,
 *   columns?: number,
 *   rows?: number,
 *   marginLeftMm?: number,
 *   marginTopMm?: number,
 *   gapXMm?: number,
 *   gapYMm?: number,
 *   startOffset?: number,
 *   fontBytes?: Uint8Array | ArrayBuffer,
 * }} sheet
 * @returns {Promise<Uint8Array>} PDF 문서 바이트 배열
 */
export async function renderSheetPdf(labels, sheet) {
  if (!Array.isArray(labels)) {
    throw new TypeError('labels 인자는 레이블 객체의 배열이어야 합니다.');
  }

  const sheetLayout = resolveSheetTemplate(sheet);
  const startOffset = Math.max(0, parseInt(sheet?.startOffset ?? sheetLayout.startOffset ?? 0, 10) || 0);
  const fontBytes = sheet?.fontBytes || sheetLayout.fontBytes;

  const pdfDoc = await PDFDocument.create();

  // 한글 폰트 임베딩 처리
  let font;
  if (fontBytes) {
    pdfDoc.registerFontkit(fontkit);
    try {
      font = await pdfDoc.embedFont(fontBytes);
    } catch (fontErr) {
      // 폰트 바이트 파싱 실패 시 기본 폰트로 폴백
      font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
    }
  } else {
    // 폰트가 지정되지 않은 경우 표준 Helvetica 사용
    font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  }

  const {
    labelTemplate,
    columns,
    rows,
    marginLeftMm,
    marginTopMm,
    gapXMm,
    gapYMm,
  } = sheetLayout;

  const capacityPerPage = Math.max(1, columns * rows);
  const totalSlotsNeeded = startOffset + labels.length;
  const totalPages = Math.max(1, Math.ceil(totalSlotsNeeded / capacityPerPage));

  const labelW_Pt = labelTemplate.widthMm * MM_TO_PT;
  const labelH_Pt = labelTemplate.heightMm * MM_TO_PT;
  const marginPt = labelTemplate.marginMm * MM_TO_PT;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

    for (let slot = 0; slot < capacityPerPage; slot++) {
      // 첫 페이지에서 startOffset 이전의 슬롯은 비워둠 (이미 사용된 시트 건너뛰기)
      if (pageIdx === 0 && slot < startOffset) {
        continue;
      }

      const globalSlotIndex = pageIdx * capacityPerPage + slot;
      const labelIndex = globalSlotIndex - startOffset;

      if (labelIndex < 0 || labelIndex >= labels.length) {
        break; // 더 이상 인쇄할 라벨 없음
      }

      const label = labels[labelIndex];
      const col = slot % columns;
      const row = Math.floor(slot / columns);

      // 시트 내 라벨 박스 좌표 계산 (PDF 좌표계: 원점은 좌측 하단)
      const leftMm = marginLeftMm + col * (labelTemplate.widthMm + gapXMm);
      const topMm = marginTopMm + row * (labelTemplate.heightMm + gapYMm);

      const labelX_Pt = leftMm * MM_TO_PT;
      const labelY_Pt = A4_HEIGHT_PT - (topMm + labelTemplate.heightMm) * MM_TO_PT;

      // 1) QR 코드 생성 및 벡터 사각형 그리기
      const payload = encodeLabel({ type: label.type, id: label.id });
      const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
      const qrCount = qr.modules.size;

      const qrSizeMm = Math.max(5, Math.min(labelTemplate.heightMm - 2 * labelTemplate.marginMm, (labelTemplate.widthMm - 2 * labelTemplate.marginMm) * 0.42));
      const qrSizePt = qrSizeMm * MM_TO_PT;
      const cellPt = qrSizePt / qrCount;

      const qrX_Pt = labelX_Pt + marginPt;
      const qrY_Pt = labelY_Pt + (labelH_Pt - qrSizePt) / 2;

      for (let r = 0; r < qrCount; r++) {
        for (let c = 0; c < qrCount; c++) {
          if (qr.modules.get(r, c)) {
            page.drawRectangle({
              x: qrX_Pt + c * cellPt,
              // PDF는 Y축이 아래에서 위로 증가하므로 행 인덱스를 반전
              y: qrY_Pt + (qrCount - 1 - r) * cellPt,
              width: cellPt + 0.1, // 틈새 방지
              height: cellPt + 0.1,
              color: rgb(0, 0, 0),
            });
          }
        }
      }

      // 2) 텍스트 영역 계산
      const textX_Pt = qrX_Pt + qrSizePt + 1.5 * MM_TO_PT;
      const availableW_Mm = labelTemplate.widthMm - (labelTemplate.marginMm + qrSizeMm + 1.5 + labelTemplate.marginMm);

      const titleFontSizePt = Math.max(5, labelTemplate.titleFontSizeMm * MM_TO_PT);
      const detailFontSizePt = Math.max(4, labelTemplate.detailFontSizeMm * MM_TO_PT);

      const maxTitleLines = labelTemplate.heightMm <= 12 ? 1 : 2;
      const titleLines = wrapOrTruncateText(label.title || label.id, availableW_Mm, labelTemplate.titleFontSizeMm, maxTitleLines);

      let textY_Pt = labelY_Pt + labelH_Pt - marginPt - titleFontSizePt * 0.9;

      // 타이틀 출력
      for (const tLine of titleLines) {
        try {
          page.drawText(tLine, {
            x: textX_Pt,
            y: textY_Pt,
            size: titleFontSizePt,
            font,
            color: rgb(0.07, 0.09, 0.15),
          });
        } catch {
          // 글리프 지원 불가 시 안전 대비
        }
        textY_Pt -= titleFontSizePt * 1.25;
      }

      // 세부 항목 출력
      const rawDetails = [];
      if (Array.isArray(label.detailLines)) {
        for (const d of label.detailLines) {
          if (typeof d === 'string' && d.trim()) rawDetails.push(d.trim());
        }
      }
      if (label.ghsCodes) {
        const ghs = Array.isArray(label.ghsCodes) ? label.ghsCodes.filter(Boolean).join(' ') : String(label.ghsCodes);
        if (ghs.trim()) rawDetails.push(`[${ghs.trim()}]`);
      }

      textY_Pt -= 1.0 * MM_TO_PT;

      for (const detail of rawDetails) {
        if (textY_Pt < labelY_Pt + marginPt) break; // 라벨 하단 오버플로 방지

        const wrapped = wrapOrTruncateText(detail, availableW_Mm, labelTemplate.detailFontSizeMm, 1);
        if (wrapped.length > 0) {
          try {
            const isGhs = detail.startsWith('[') && detail.endsWith(']');
            page.drawText(wrapped[0], {
              x: textX_Pt,
              y: textY_Pt,
              size: detailFontSizePt,
              font,
              color: isGhs ? rgb(0.72, 0.11, 0.11) : rgb(0.29, 0.33, 0.39),
            });
          } catch {}
          textY_Pt -= detailFontSizePt * 1.25;
        }
      }
    }
  }

  return pdfDoc.save();
}

export { SHEET_TEMPLATES };
