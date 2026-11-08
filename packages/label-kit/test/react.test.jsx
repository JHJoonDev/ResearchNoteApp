import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { LabelScanner } from '../src/react.jsx';

describe('react - LabelScanner 컴포넌트 동작 및 안전성 검증', () => {
  let mockTrack;
  let mockStream;
  let originalGetUserMedia;
  let originalBarcodeDetector;

  beforeEach(() => {
    mockTrack = {
      stop: vi.fn(),
      kind: 'video',
    };

    mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
    };

    originalGetUserMedia = navigator.mediaDevices?.getUserMedia;
    if (!navigator.mediaDevices) {
      // @ts-ignore
      navigator.mediaDevices = {};
    }
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(mockStream);

    originalBarcodeDetector = window.BarcodeDetector;

    // HTMLMediaElement play mock
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalGetUserMedia) {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
    if (originalBarcodeDetector !== undefined) {
      window.BarcodeDetector = originalBarcodeDetector;
    } else {
      delete window.BarcodeDetector;
    }
  });

  it('언마운트 시 모든 활성 카메라 트랙이 즉시 정지(track.stop())되는지 검증', async () => {
    const onScan = vi.fn();
    const { unmount } = render(<LabelScanner onScan={onScan} />);

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
    expect(mockTrack.stop).not.toHaveBeenCalled();

    // 언마운트 실행
    unmount();

    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it('카메라 권한 거부(NotAllowedError) 시 한국어 안내 메시지 표시 및 onError 호출', async () => {
    const permError = new Error('Permission denied');
    permError.name = 'NotAllowedError';
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(permError);

    const onScan = vi.fn();
    const onError = vi.fn();

    render(<LabelScanner onScan={onScan} onError={onError} />);

    await waitFor(() => {
      expect(screen.getByText(/카메라 접근 권한이 거부되었습니다/)).toBeTruthy();
      expect(onError).toHaveBeenCalledWith(permError);
    });
  });

  it('카메라 장치 없음(NotFoundError) 시 한국어 안내 메시지 표시', async () => {
    const noDeviceError = new Error('No camera found');
    noDeviceError.name = 'NotFoundError';
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(noDeviceError);

    const onScan = vi.fn();
    render(<LabelScanner onScan={onScan} />);

    await waitFor(() => {
      expect(screen.getByText(/사용 가능한 카메라 장치를 찾을 수 없습니다/)).toBeTruthy();
    });
  });

  it('네이티브 BarcodeDetector가 유효한 코드를 감지하면 onScan을 호출', async () => {
    const onScan = vi.fn();

    class MockBarcodeDetector {
      constructor() {
        this.detect = vi.fn().mockResolvedValue([
          { rawValue: 'LH1:reagent:R-9988' },
        ]);
      }
    }
    // @ts-ignore
    window.BarcodeDetector = MockBarcodeDetector;

    render(<LabelScanner onScan={onScan} />);

    // 비디오 readyState mock
    const video = document.querySelector('video');
    if (video) {
      Object.defineProperty(video, 'readyState', { value: 4 });
      Object.defineProperty(video, 'videoWidth', { value: 640 });
      Object.defineProperty(video, 'videoHeight', { value: 480 });
    }

    await waitFor(() => {
      expect(onScan).toHaveBeenCalledWith({
        type: 'reagent',
        id: 'R-9988',
      });
    });
  });

  it('무효한 페이로드(URL, 임의 문자열 등) 감지 시 onScan을 절대 호출하지 않음', async () => {
    const onScan = vi.fn();

    class MockBarcodeDetector {
      constructor() {
        this.detect = vi.fn().mockResolvedValue([
          { rawValue: 'https://evil.example.com/exploit' },
        ]);
      }
    }
    // @ts-ignore
    window.BarcodeDetector = MockBarcodeDetector;

    render(<LabelScanner onScan={onScan} />);

    const video = document.querySelector('video');
    if (video) {
      Object.defineProperty(video, 'readyState', { value: 4 });
      Object.defineProperty(video, 'videoWidth', { value: 640 });
      Object.defineProperty(video, 'videoHeight', { value: 480 });
    }

    // 250ms 대기 후에도 onScan이 호출되지 않음 확인
    await new Promise((r) => setTimeout(r, 250));
    expect(onScan).not.toHaveBeenCalled();
  });

  it('동일한 코드의 연속 스캔 시 디바운스(debounceMs) 동작 검증', async () => {
    const onScan = vi.fn();

    class MockBarcodeDetector {
      constructor() {
        this.detect = vi.fn().mockResolvedValue([
          { rawValue: 'LH1:sample:SMP-REPEAT-1' },
        ]);
      }
    }
    // @ts-ignore
    window.BarcodeDetector = MockBarcodeDetector;

    // 400ms debounce
    render(<LabelScanner onScan={onScan} debounceMs={400} />);

    const video = document.querySelector('video');
    if (video) {
      Object.defineProperty(video, 'readyState', { value: 4 });
      Object.defineProperty(video, 'videoWidth', { value: 640 });
      Object.defineProperty(video, 'videoHeight', { value: 480 });
    }

    // 1차 스캔 대기
    await waitFor(() => {
      expect(onScan).toHaveBeenCalledTimes(1);
    });

    // 100ms 후에도 debounce 기간 내이므로 호출 횟수는 여전히 1회
    await new Promise((r) => setTimeout(r, 100));
    expect(onScan).toHaveBeenCalledTimes(1);

    // 400ms 이상 경과 후 재스캔되어 2회차 호출
    await waitFor(
      () => {
        expect(onScan).toHaveBeenCalledTimes(2);
      },
      { timeout: 1500 },
    );
  });

  it('수동 입력(또는 USB 바코드 웨지 스캐너) fallback 폼 동작 검증', async () => {
    const onScan = vi.fn();
    render(<LabelScanner onScan={onScan} />);

    const input = screen.getByLabelText('레이블 코드 직접 입력');
    const submitBtn = screen.getByRole('button', { name: '확인' });

    // 1) 잘못된 코드 입력 시 에러 표시 및 onScan 미호출
    await act(async () => {
      fireEvent.change(input, { target: { value: 'invalid-string' } });
      fireEvent.click(submitBtn);
    });

    expect(onScan).not.toHaveBeenCalled();
    expect(screen.getByText(/올바른 레이블 코드가 아닙니다/)).toBeTruthy();

    // 2) 올바른 코드 입력 시 onScan 호출 및 폼 초기화
    await act(async () => {
      fireEvent.change(input, { target: { value: 'LH1:equipment:CENTRIFUGE-01' } });
      fireEvent.click(submitBtn);
    });

    expect(onScan).toHaveBeenCalledWith({
      type: 'equipment',
      id: 'CENTRIFUGE-01',
    });
    expect(input.value).toBe('');
  });
});
