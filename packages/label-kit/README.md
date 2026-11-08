# @labhub/label-kit

LabHub LIMS/ELN 시스템을 위한 브라우저 안전(Browser-safe) 순수 ESM 레이블 생성, 렌더링, 인쇄 및 스캔 통합 패키지입니다.

## 기능 요약
- **페이로드 코덱 (`@labhub/label-kit`)**: `LH1:<type>:<id>` 규격 인코딩/디코딩, 비정상 입력 및 URL 주입 원천 차단.
- **SVG 렌더링 (`@labhub/label-kit`)**: CSP-safe 인라인 SVG, XML 이스케이프, 한글 줄바꿈 및 오버플로 방지.
- **ZPL 렌더링 (`@labhub/label-kit`)**: Zebra 프린터 UTF-8(`^CI28`), `^BQ` QR 코드, `^`/`~` 명령어 인젝션 방지.
- **A4 라벨 시트 PDF (`@labhub/label-kit/pdf`)**: `pdf-lib` 기반 다중 페이지, 사용자 한글 폰트 임베딩, 잔여 시트 재사용(`startOffset`).
- **QR 스캐너 컴포넌트 (`@labhub/label-kit/react`)**: React 19 호환, 네이티브 `BarcodeDetector` 우선 + `jsQR` 캔버스 폴백, 언마운트 시 트랙 정리, 권한 오류 한국어 안내, 수동/USB 웨지 스캐너 입력 지원.
