# ResearchNoteApp / LIMS

React, Express, MongoDB 기반 연구노트(ELN) 및 시약 관리(LIMS) 포트폴리오 프로젝트입니다.

이 저장소는 연구 기록 관리, 시약 재고 관리, 승인/감사 로그, 알림, 보고서 생성을 하나의 연구실 업무 도구로 묶어 구현한 학습/포트폴리오용 repository입니다.

## 프로젝트 개요

연구실에서 반복적으로 발생하는 기록, 승인, 재고 확인, 보고서 작성 흐름을 웹 애플리케이션으로 구성했습니다.

주요 기능:

- 연구노트 작성/수정/조회
- 연구노트 승인 흐름과 변경 이력 관리
- 시약/소모품 재고 및 유효기간 관리
- audit log 기록
- 알림 및 Socket.IO 기반 실시간 알림 전달
- 주간 보고서 생성
- tenant/compliance mode 기반 쓰기 제한 실험
- MongoDB 미연결 시 `mongodb-memory-server`를 사용한 로컬 개발 fallback

## 기술 스택

### Backend

- Node.js
- Express
- MongoDB / Mongoose
- JWT 인증
- Socket.IO
- Multer
- Handlebars
- Puppeteer
- mongodb-memory-server

### Frontend

- React
- Vite
- Zustand
- Axios
- React Router
- React Quill
- Recharts
- html2pdf.js / docx

## 구조

```text
backend/
  models/       User, Tenant, ElnNote, LimsItem, AuditLog 등
  routes/       auth, eln, lims, audit, reports, notifications 등
  middleware/   auth/compliance middleware
  templates/    weekly report template

frontend/
  src/pages/    Dashboard, ELN, LIMS, AuditLogs, ReportGenerator 등
  src/store/    auth/app state
  src/api/      axios client

draft/
  초기 정적 화면 prototype
```

## 실행 방법

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

`.env`의 `JWT_SECRET`은 반드시 임의의 긴 값으로 설정합니다.

`MONGO_URI`를 비워두면 개발 편의를 위해 `mongodb-memory-server`가 실행됩니다. 실제 MongoDB에 연결하려면 `.env`에 `MONGO_URI`를 설정합니다.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

## 기본 개발 계정

로컬 DB가 비어 있으면 개발 확인용 계정이 seed됩니다.

- email: `test@labhub.com`
- password: `password`

운영용 계정이 아니며, 포트폴리오/로컬 시연 용도입니다.

## 포트폴리오에서 볼 부분

- `backend/routes/eln.js`: 연구노트 CRUD, 승인 흐름, 재고 차감 연결
- `backend/routes/lims.js`: 시약 재고/상태 관리
- `backend/routes/audit.js`: 감사 로그
- `backend/middleware/compliance.js`: compliance mode 쓰기 제한
- `backend/models/*.js`: ELN/LIMS 도메인 모델
- `frontend/src/pages/ELN*.jsx`: 연구노트 화면
- `frontend/src/pages/LIMS.jsx`: 시약 관리 화면
- `frontend/src/pages/AuditLogs.jsx`: 감사 로그 화면

## 제외한 항목

- `.env`
- 실제 MongoDB URI
- 운영 JWT secret
- 업로드 파일
- `node_modules`
- frontend build 산출물

## 현재 한계

- 테스트 자동화는 충분하지 않습니다.
- 기본 seed 계정은 로컬 시연용입니다.
- compliance mode는 실무 규정 완전 대응이 아니라 쓰기 제한 구조를 실험한 수준입니다.
- 전자서명/감사추적은 학습용 구현이며 실제 GMP/GLP 검증 시스템으로 사용할 수 없습니다.
