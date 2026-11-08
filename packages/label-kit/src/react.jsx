/**
 * @fileoverview React 19 호환 레이블 QR 스캐너 컴포넌트 (@labhub/label-kit/react)
 * 네이티브 BarcodeDetector 우선 사용, 미지원 시 jsQR 캔버스 폴백
 * 언마운트 시 카메라 트랙 정지, 권한/장치 없음 한국어 안내, 수동/USB 웨지 스캐너 입력 지원
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { decodeLabel } from './codec.js';

/**
 * @typedef {Object} LabelScannerProps
 * @property {(result: { type: 'reagent'|'lot'|'sample'|'equipment'|'location', id: string }) => void} onScan
 * @property {(error: Error) => void} [onError]
 * @property {string} [className]
 * @property {number} [debounceMs] 중복 스캔 방지 쿨다운 시간(ms), 기본 1500ms
 * @property {boolean} [showManualInput] 수동 입력창 표시 여부 (기본 true)
 */

/**
 * QR/바코드 카메라 스캐너 컴포넌트
 * @param {LabelScannerProps} props
 */
export function LabelScanner({
  onScan,
  onError,
  className = '',
  debounceMs = 1500,
  showManualInput = true,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const timerRef = useRef(null);
  const isMountedRef = useRef(true);
  const lastScanRef = useRef({ key: '', time: 0 });

  const [cameraError, setCameraError] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState(null);

  /**
   * 유효한 페이로드를 처리하고 중복 감지를 디바운스합니다.
   * 무효한 페이로드는 조용히 무시하며 절대로 웹 탐색(navigate)이나 네트워크 요청(fetch)을 실행하지 않습니다.
   */
  const handlePayload = useCallback(
    (rawPayload) => {
      if (!rawPayload || typeof rawPayload !== 'string') return;

      const decoded = decodeLabel(rawPayload);
      if (!decoded.ok) {
        // 무효 페이로드는 onScan을 호출하지 않고 무시
        return;
      }

      const key = `${decoded.type}:${decoded.id}`;
      const now = Date.now();

      // 동일 코드 연속 스캔 디바운스 (지정된 시간 내 중복 스캔 방지)
      if (lastScanRef.current.key === key && now - lastScanRef.current.time < debounceMs) {
        return;
      }

      lastScanRef.current = { key, time: now };
      if (typeof onScan === 'function') {
        onScan({ type: decoded.type, id: decoded.id });
      }
    },
    [onScan, debounceMs],
  );

  /**
   * 카메라 스트림 시작 및 프레임 스캔 루프 초기화
   */
  useEffect(() => {
    isMountedRef.current = true;
    let barcodeDetector = null;

    // 네이티브 BarcodeDetector 지원 여부 확인
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        barcodeDetector = null;
      }
    }

    async function startCamera() {
      if (!navigator?.mediaDevices?.getUserMedia) {
        const err = new Error('브라우저에서 카메라 미디어 장치를 지원하지 않습니다.');
        setCameraError('브라우저가 카메라 접근 기능을 지원하지 않습니다.');
        if (typeof onError === 'function') onError(err);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });

        if (!isMountedRef.current) {
          // 마운트 해제 후 스트림이 획득된 경우 즉시 트랙 정지
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          await videoRef.current.play().catch(() => {});
        }

        setIsScanning(true);
        setCameraError(null);
        startScanLoop(barcodeDetector);
      } catch (err) {
        if (!isMountedRef.current) return;

        let koreanMsg = '카메라를 시작할 수 없습니다.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          koreanMsg = '카메라 접근 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 허용해 주세요.';
        } else if (
          err.name === 'NotFoundError' ||
          err.name === 'DevicesNotFoundError' ||
          err.name === 'OverconstrainedError'
        ) {
          koreanMsg = '사용 가능한 카메라 장치를 찾을 수 없습니다.';
        } else {
          koreanMsg = `카메라를 시작할 수 없습니다: ${err.message || '알 수 없는 오류'}`;
        }

        setCameraError(koreanMsg);
        setIsScanning(false);
        if (typeof onError === 'function') onError(err);
      }
    }

    /**
     * 프레임별 바코드 감지 루프 (네이티브 BarcodeDetector 우선, jsQR 폴백)
     */
    function startScanLoop(detector) {
      const scanFrame = async () => {
        if (!isMountedRef.current) return;

        const video = videoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth === 0) {
          timerRef.current = setTimeout(scanFrame, 150);
          return;
        }

        let detectedCode = null;

        if (detector) {
          // 1) 네이티브 BarcodeDetector 사용
          try {
            const barcodes = await detector.detect(video);
            if (barcodes && barcodes.length > 0) {
              detectedCode = barcodes[0].rawValue;
            }
          } catch {
            // 네이티브 탐지 실패 시 detector 비활성화하고 jsQR로 자동 전환
            detector = null;
          }
        }

        if (!detector && !detectedCode) {
          // 2) jsQR 캔버스 프레임 폴백
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imgData.data, canvas.width, canvas.height, {
                inversionAttempts: 'dontInvert',
              });
              if (code && code.data) {
                detectedCode = code.data;
              }
            }
          }
        }

        if (detectedCode) {
          handlePayload(detectedCode);
        }

        if (isMountedRef.current) {
          timerRef.current = setTimeout(scanFrame, 120);
        }
      };

      timerRef.current = setTimeout(scanFrame, 120);
    }

    startCamera();

    // 클린업: 언마운트 시 모든 비디오 트랙 즉시 중지 및 타이머 해제
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [handlePayload, onError]);

  // 수동 입력 및 USB 바코드 웨지 스캐너 폼 제출 핸들러
  const handleManualSubmit = (e) => {
    e.preventDefault();
    setManualError(null);

    const trimmed = manualInput.trim();
    if (!trimmed) return;

    const decoded = decodeLabel(trimmed);
    if (!decoded.ok) {
      setManualError(`올바른 레이블 코드가 아닙니다: ${decoded.reason}`);
      return;
    }

    handlePayload(trimmed);
    setManualInput('');
  };

  return (
    <div
      className={`labhub-scanner-container ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        maxWidth: '480px',
        margin: '0 auto',
      }}
    >
      {/* 카메라 뷰파인더 영역 */}
      <div
        className="labhub-scanner-viewfinder"
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          backgroundColor: '#111827',
          borderRadius: '8px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
        }}
      >
        <video
          ref={videoRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraError ? 'none' : 'block',
          }}
          muted
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* 카메라 에러 또는 안내 오버레이 */}
        {cameraError && (
          <div
            className="labhub-scanner-error"
            style={{
              padding: '16px',
              textAlign: 'center',
              backgroundColor: 'rgba(185, 28, 28, 0.9)',
              color: '#ffffff',
              fontSize: '14px',
              lineHeight: '1.5',
              borderRadius: '6px',
              margin: '16px',
            }}
          >
            <p style={{ margin: 0, fontWeight: 'bold' }}>카메라 사용 불가</p>
            <p style={{ margin: '8px 0 0 0' }}>{cameraError}</p>
          </div>
        )}

        {/* 스캔 가이드 라인 (카메라 동작 시) */}
        {!cameraError && isScanning && (
          <div
            className="labhub-scanner-guide"
            style={{
              position: 'absolute',
              width: '60%',
              aspectRatio: '1 / 1',
              border: '2px solid rgba(59, 130, 246, 0.8)',
              borderRadius: '8px',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* 수동 입력 및 USB 웨지 스캐너 폼 */}
      {showManualInput && (
        <form
          onSubmit={handleManualSubmit}
          className="labhub-scanner-manual-form"
          style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={manualInput}
              onChange={(e) => {
                setManualInput(e.target.value);
                if (manualError) setManualError(null);
              }}
              placeholder="코드 직접 입력 (예: LH1:reagent:R-01) 또는 바코드 스캐너 입력"
              aria-label="레이블 코드 직접 입력"
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              확인
            </button>
          </div>
          {manualError && (
            <p
              className="labhub-manual-error"
              style={{ margin: 0, fontSize: '13px', color: '#dc2626' }}
            >
              {manualError}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

export default LabelScanner;
