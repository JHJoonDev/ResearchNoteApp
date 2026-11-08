import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { encodeLabel, decodeLabel } from '../src/codec.js';

describe('roundtrip - QR 코드 렌더링 및 jsQR 디코딩 왕복 무결성 검증', () => {
  /**
   * QR 매트릭스를 jsQR이 읽을 수 있는 RGBA 픽셀 버퍼(Uint8ClampedArray)로 변환합니다.
   * @param {string} payload
   * @param {number} scale
   * @param {number} quietZone
   */
  function qrToRgbaBuffer(payload, scale = 4, quietZone = 4) {
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const moduleCount = qr.modules.size;
    const totalModules = moduleCount + quietZone * 2;
    const pixelWidth = totalModules * scale;
    const pixelHeight = pixelWidth;
    const data = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);

    // 전체 흰색 배경 초기화
    data.fill(255);

    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.modules.get(r, c)) {
          // 검은색 모듈 채우기
          const startX = (c + quietZone) * scale;
          const startY = (r + quietZone) * scale;

          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const pxIndex = ((startY + dy) * pixelWidth + (startX + dx)) * 4;
              data[pxIndex] = 0; // R
              data[pxIndex + 1] = 0; // G
              data[pxIndex + 2] = 0; // B
              data[pxIndex + 3] = 255; // A
            }
          }
        }
      }
    }

    return { data, width: pixelWidth, height: pixelHeight };
  }

  it('5가지 유형의 라벨 페이로드가 QR 렌더링 후 jsQR로 100% 동일하게 복원되는지 검증', () => {
    const testCases = [
      { type: 'reagent', id: 'RG-9901-ACETONE' },
      { type: 'lot', id: 'LOT-2026-NOV-A' },
      { type: 'sample', id: 'SMP_PLASMA_042' },
      { type: 'equipment', id: 'EQ-HPLC-02' },
      { type: 'location', id: 'LOC-COLD-SHELF-3' },
    ];

    for (const testCase of testCases) {
      const payload = encodeLabel(testCase);
      const { data, width, height } = qrToRgbaBuffer(payload, 4, 4);

      // jsQR 디코딩 수행
      const detected = jsQR(data, width, height);

      expect(detected).not.toBeNull();
      expect(detected?.data).toBe(payload);

      // 디코딩된 데이터로 레이블 복원
      const decodedLabel = decodeLabel(detected.data);
      expect(decodedLabel.ok).toBe(true);
      if (decodedLabel.ok) {
        expect(decodedLabel.type).toBe(testCase.type);
        expect(decodedLabel.id).toBe(testCase.id);
      }
    }
  });
});
