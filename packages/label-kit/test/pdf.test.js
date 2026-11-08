import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { renderSheetPdf } from '../src/pdf.js';
import { SHEET_TEMPLATES } from '../src/templates.js';

describe('pdf - A4 라벨 시트 PDF 렌더링 검증', () => {
  // 테스트용 라벨 생성 헬퍼
  function createTestLabels(count) {
    const labels = [];
    for (let i = 0; i < count; i++) {
      labels.push({
        type: 'sample',
        id: `SMP-${String(i + 1).padStart(4, '0')}`,
        title: `실험 시료 번호 #${i + 1}`,
        detailLines: [`Lot: L-2026-${i + 1}`, '농도: 10 mM'],
        ghsCodes: ['GHS07'],
      });
    }
    return labels;
  }

  // 한글 폰트 로드 (backend/assets/fonts/NotoSansKR.ttf)
  let koreanFontBytes = null;
  const fontPath = path.resolve(process.cwd(), '../../backend/assets/fonts/NotoSansKR.ttf');
  if (fs.existsSync(fontPath)) {
    koreanFontBytes = fs.readFileSync(fontPath);
  }

  it('PDF 페이지 수 계산 및 다중 페이지 분할 검증', async () => {
    // 50x25 규격은 페이지당 3열 x 10행 = 30개 라벨
    const sheetConfig = {
      ...SHEET_TEMPLATES['50x25'],
      fontBytes: koreanFontBytes,
    };

    // 1) 15개 라벨 -> 1페이지
    const pdf15 = await renderSheetPdf(createTestLabels(15), sheetConfig);
    const doc15 = await PDFDocument.load(pdf15);
    expect(doc15.getPageCount()).toBe(1);

    // 2) 30개 라벨 -> 정확히 1페이지
    const pdf30 = await renderSheetPdf(createTestLabels(30), sheetConfig);
    const doc30 = await PDFDocument.load(pdf30);
    expect(doc30.getPageCount()).toBe(1);

    // 3) 31개 라벨 -> 2페이지
    const pdf31 = await renderSheetPdf(createTestLabels(31), sheetConfig);
    const doc31 = await PDFDocument.load(pdf31);
    expect(doc31.getPageCount()).toBe(2);

    // 4) 65개 라벨 -> 3페이지 (30 + 30 + 5)
    const pdf65 = await renderSheetPdf(createTestLabels(65), sheetConfig);
    const doc65 = await PDFDocument.load(pdf65);
    expect(doc65.getPageCount()).toBe(3);
  });

  it('시트 재사용 startOffset 건너뛰기 및 페이지 확장 검증', async () => {
    // 50x25 규격 (페이지당 30개)
    // 10개 라벨을 인쇄하되, 이전에 25개를 사용한 잔여 시트 (startOffset = 25)
    // 25개 건너뜀 + 10개 라벨 = 총 35개 슬롯 필요 -> 2페이지로 확장되어야 함
    const sheetConfig = {
      ...SHEET_TEMPLATES['50x25'],
      startOffset: 25,
      fontBytes: koreanFontBytes,
    };

    const pdfBytes = await renderSheetPdf(createTestLabels(10), sheetConfig);
    const doc = await PDFDocument.load(pdfBytes);

    expect(doc.getPageCount()).toBe(2);
    expect(pdfBytes.length).toBeGreaterThan(1000);
  });

  it('다양한 표준 시트 규격(25x10, 38x19, 70x37) PDF 생성 유효성 검증', async () => {
    for (const sheetName of ['25x10', '38x19', '70x37']) {
      const labels = createTestLabels(5);
      const pdfBytes = await renderSheetPdf(labels, {
        name: sheetName,
        fontBytes: koreanFontBytes,
      });

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      // PDF 매직 넘버 (%PDF-) 확인
      const header = Buffer.from(pdfBytes.slice(0, 5)).toString('ascii');
      expect(header).toBe('%PDF-');

      const doc = await PDFDocument.load(pdfBytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });
});
