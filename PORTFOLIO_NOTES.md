# Portfolio Notes

## 검토 목적

이 프로젝트는 연구노트/시약 관리 도메인을 웹 앱으로 모델링한 포트폴리오용 작업입니다. 완성된 상용 LIMS가 아니라, 연구 기록과 재고 관리 흐름을 직접 설계하고 구현해 본 경험을 보여주는 목적입니다.

## 주요 확인 파일

- `backend/server.js`
- `backend/models/ElnNote.js`
- `backend/models/LimsItem.js`
- `backend/models/AuditLog.js`
- `backend/routes/eln.js`
- `backend/routes/lims.js`
- `backend/routes/audit.js`
- `backend/middleware/compliance.js`
- `frontend/src/pages/ELN.jsx`
- `frontend/src/pages/ELNEditor.jsx`
- `frontend/src/pages/LIMS.jsx`
- `frontend/src/pages/ReportGenerator.jsx`

## 면접에서 설명할 포인트

- 연구노트 작성과 승인 상태를 별도 필드로 관리했습니다.
- 시약 재고/만료 상태를 주기적으로 갱신하고 알림을 생성하는 흐름을 구성했습니다.
- MongoDB 연결이 없을 때도 `mongodb-memory-server`로 로컬 개발을 이어갈 수 있게 했습니다.
- audit log와 compliance mode를 두어 연구 기록 시스템에서 필요한 검증 관점을 학습했습니다.

## 명확히 말할 한계

- 실제 GMP/GLP 인증 시스템은 아닙니다.
- 전자서명, 권한 분리, 변경 불가 audit trail은 추가 설계가 필요합니다.
- 테스트와 배포 자동화는 보완이 필요합니다.
