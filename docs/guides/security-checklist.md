# 운영 배포 전 보안 점검표 (Security Checklist)

본 점검표는 LabHub 전자연구노트 시스템을 실제 운영 환경(Production)에 배포하기 전에 보안 관리자 및 시스템 운영자가 반드시 확인해야 하는 필수 항목들을 정의합니다.

---

## 1. 비밀값 및 암호화 키 관리

- [ ] **기본 비밀값 사용 금지**
  - `.env.example`의 기본 예시 문자열(`CHANGE_THIS_...`)이 실제 운영 환경에 남아있지 않은지 확인했습니다.
- [ ] **암호학적으로 안전한 난수 사용**
  - `JWT_SECRET`: `openssl rand -hex 32` 등을 통해 최소 32자 이상의 임의 문자열로 생성되었습니다.
  - `DATA_ENCRYPTION_KEY`: `openssl rand -base64 32`를 통해 32바이트 Base64 인코딩 값으로 생성되었습니다 (MFA 암호화 등에 사용).
  - `MONGO_ROOT_PASSWORD` 및 `MONGO_APP_PASSWORD`: 최소 32자 이상의 난수로 설정되었습니다.
- [ ] **키 오프라인 격리 백업**
  - `DATA_ENCRYPTION_KEY` 및 `JWT_SECRET`을 유실에 대비하여 안전한 오프라인 매체(물리 금고 등)에 백업해 두었습니다.
- [ ] **S3 스토리지 자격증명 최소 권한 원칙**
  - S3 객체 스토리지 연동 시, 전용 IAM 사용자를 생성하여 지정된 버킷에 대한 읽기/쓰기 최소 권한만 부여하고 루트 계정 자격증명을 사용하지 않았는지 확인했습니다.
- [ ] **Git 및 이미지 포함 방지**
  - `.env` 파일과 실제 키가 Git 저장소 커밋 이력에 포함되지 않았음을 확인했습니다 (`git status`, `Dockerfile.dockerignore` 검증).
- [ ] **`SETUP_TOKEN` 비활성화**
  - 최초 관리자 계정 생성이 완료된 후 `SETUP_TOKEN` 값을 제거하거나 무효화했습니다.

---

## 2. 네트워크 및 전송 계층 보안 (TLS/HTTPS)

- [ ] **전구간 HTTPS 강제 적용**
  - 역방향 프록시(Caddy)를 통해 유효한 공인 TLS/SSL 인증서가 발급되었거나 설치되었습니다.
  - HTTP(80) 요청이 자동으로 HTTPS(443)로 리다이렉트되는지 확인했습니다.
- [ ] **보안 헤더 설정 점검**
  - HSTS(`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`)가 활성화되었습니다.
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` 헤더가 응답에 포함되어 있습니다.
- [ ] **CORS 및 접근 통제**
  - `CORS_ORIGIN`에 와일드카드(`*`)가 아닌 실제 서비스 도메인(`https://your-lab-domain`)만 지정되었습니다.
- [ ] **내부 포트 격리**
  - MongoDB(27017) 및 Node.js(5000) 포트가 공용 인터넷에 직접 노출되지 않고, 오직 Docker 내부 네트워크 또는 Caddy 프록시를 통해서만 통신하도록 구성되었습니다.
- [ ] **역방향 프록시 홉 및 실제 클라이언트 IP 신뢰 (`TRUST_PROXY`)**
  - Caddy 역방향 프록시 1홉 환경에 맞춰 `TRUST_PROXY=1`이 설정되어 있는지 확인했습니다 (`true` 대신 명시적 홉 수 `1` 지정). 이를 통해 감사 로그의 클라이언트 IP와 로그인 레이트 리밋이 프록시 내부 IP로 일괄 취급되는 문제를 방지합니다.

---

## 3. 인증, 세션 및 계정 보안

- [ ] **쿠키 보안 속성 확인**
  - 세션 쿠키(`labhub_session`)에 `HttpOnly`, `SameSite=Strict`, `Secure` 플래그가 적용되어 브라우저 JavaScript를 통한 탈취가 차단되었는지 확인했습니다.
- [ ] **CSRF 방어 헤더 적용**
  - 모든 상태 변경 API(`POST`, `PUT`, `DELETE`)에 `X-LabHub-Request: 1` 헤더 요구 조건이 동작하고 있는지 점검했습니다.
- [ ] **MFA (2단계 인증) 활성화**
  - 시스템 관리자 및 프로젝트 책임자 계정에 대해 TOTP 기반 2단계 인증을 필수로 설정했습니다.
- [ ] **로그인 무차별 대입 방지**
  - 실패 횟수 기반 계정 일시 잠금 및 레이트 리밋(`express-rate-limit`)이 정상 동작하는지 확인했습니다.
- [ ] **OIDC 단일 로그인(SSO) 보안 점검**
  - OIDC 연동 시 IdP에 등록된 리다이렉트 URI가 HTTPS 정규 URL(`https://<APP_DOMAIN>/api/auth/oidc/callback`)과 일치하는지 확인했습니다.
  - 최초 SSO 로그인 시 로컬 비밀번호 로그인이 차단(`ssoOnly: true`)되는 정책을 확인했습니다.
- [ ] **분석 장비 API 키 분리 관리**
  - 분석 장비 PC 연동 시 장비별로 개별 API 키를 발급하고, PC 교체/폐기 시 즉시 해당 키를 비활성화할 수 있도록 관리 방안을 수립했습니다.
- [ ] **개발 모드 잔존 방지**
  - `TIMESTAMP_PROVIDER=dev-local` 설정이 운영(`NODE_ENV=production`)에서 차단되는지 확인했습니다.

---

## 4. 데이터베이스 및 저장소 보안

- [ ] **MongoDB 인증 및 Replica Set Keyfile 활성화**
  - 단일 노드 Replica Set에 `--auth`와 내부 통신용 `--keyFile`이 올바르게 적용되어 무인증 접근이 불가능함을 확인했습니다.
- [ ] **비 root 권한 실행**
  - Node.js 컨테이너가 `node` 비특권 계정(`USER node`)으로 실행되고 있는지 점검했습니다.
- [ ] **데이터 및 증빙 볼륨 영속화**
  - `mongo_data` 및 `app_data`(`/app/backend/data` 전체)가 명명된 Docker 볼륨으로 분리되어 컨테이너 재시작 시에도 첨부파일, 봉인 PDF, 키가 온전히 보존되는지 확인했습니다.

---

## 5. 증빙 무결성 및 백업 운영

- [ ] **시점인증(TSA) 정책 결정**
  - 기관 성격에 따라 민간 RFC 3161 계약 또는 국가 연구노트 포털 신청 계획을 확정하고 환경변수에 반영했습니다.
- [ ] **AI 데이터 대외 전송 정책 승인**
  - `AI_PROVIDER=anthropic` 활성화 전, 연구 프롬프트 및 노트 데이터가 외부 Anthropic API로 전송되는 사항에 대해 기관 영업비밀·특허 보안 규정 승인을 득했는지 확인했습니다.
- [ ] **예약 백업 스케줄링 확인**
  - 일일 정기 백업 스크립트(`deploy/scripts/backup.sh`)가 크론 등에 등록되어 컨테이너 내부 연동을 통해 정상 동작하는지 테스트했습니다.
- [ ] **복구 리허설 수행**
  - `deploy/scripts/restore-rehearsal.sh`를 실행하여 백업본의 복원 무결성을 실제 검증했습니다.
- [ ] **감사 로그 체인 무결성 점검**
  - 관리자 화면 또는 `/api/audit/verify`를 호출하여 해시 체인이 정상 유지되는지 확인했습니다.
