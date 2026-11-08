# LabHub 설치 및 운영 가이드

본 문서는 Docker Compose를 활용하여 LabHub 전자연구노트(ELN/LIMS) 시스템을 배포하고, 초기 관리자 계정을 설정하며, S3 스토리지·OIDC·API 키/장비 에이전트·웹훅·메일·AI 등 핵심 기능을 설정하고 운영하는 절차를 안내합니다.

> [!NOTE]
> 본 문서는 프로덕션 운영 환경 배포를 위한 공식 기술 가이드입니다. LabHub의 모든 핵심 기능(전자연구노트, LIMS 시약·재고 관리, 감사 로그 체인, 무결성 봉인, 객체 스토리지, OIDC SSO, 장비 에이전트, 웹훅)이 정식 지원됩니다. 시점인증(TSA) 및 AI 지원 기능은 기본적으로 비활성화(`none`)되어 있는 선택 사항(Optional)입니다.

---

## 1. 시스템 요구사항

### 하드웨어 권장 사양
- **CPU**: 2 Core 이상 권장
- **RAM**: 최소 4GB (8GB 이상 권장 - MongoDB WiredTiger 엔진, Caddy, Node.js 런타임 구동용)
- **스토리지**: 최소 20GB 이상의 SSD (연구노트 첨부파일, 봉인 PDF 및 장기 보존 데이터 규모에 따라 추가 증설 또는 S3 객체 스토리지 연동 권장)

### 소프트웨어 요구사항
- **OS**: Linux (Ubuntu 22.04 LTS / Debian 12 / RHEL 9 등 권장)
- **Docker Engine**: 24.0.0 이상
- **Docker Compose**: v2.20.0 이상 (Compose V2 표준)

---

## 2. 초기 설치 및 배포 절차

### 2.1 저장소 복제 및 설정 파일 준비
```bash
# 1. 프로젝트 저장소 클론
git clone <repository-url> labhub
cd labhub

# 2. 배포 환경변수 설정 파일 생성
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

### 2.2 필수 환경변수 설정
`deploy/.env` 파일을 편집하여 아래 필수 보안 키들을 생성 및 입력합니다.

> [!CAUTION]
> 비밀 키는 절대로 기본값을 사용해서는 안 되며, 외부나 버전 관리 시스템에 유출되지 않도록 엄격히 보호해야 합니다.

```bash
# 비밀키 생성 예시 (터미널에서 실행하여 출력된 값을 deploy/.env 에 입력)
openssl rand -hex 32    # MONGO_ROOT_PASSWORD
openssl rand -hex 32    # MONGO_APP_PASSWORD
openssl rand -hex 32    # JWT_SECRET
openssl rand -base64 32 # DATA_ENCRYPTION_KEY (32바이트 Base64, MFA TOTP 암호화 등에 사용)
openssl rand -hex 16    # SETUP_TOKEN
```

주요 기본 설정 항목:
- `APP_DOMAIN`: 서비스 도메인 (예: `eln.lab.ac.kr`)
- `CORS_ORIGIN`: 브라우저 접근 허용 주소 (예: `https://eln.lab.ac.kr`)
- `TRUST_PROXY`: 역방향 프록시 홉 수 (Caddy 프록시 1홉 환경에 맞춰 `deploy/docker-compose.yml`의 `app` 서비스에 `TRUST_PROXY: 1`이 기본 적용되어 있습니다. 이를 통해 클라이언트 실제 IP가 레이트 리밋 및 감사 로그에 정확히 수집됩니다.)
- `ORG_NAME`: 소속 기관명 (PDF 및 증빙 매니페스트에 표기됨)
- `RETENTION_YEARS`: 연구노트 보존 연한 (기본값 `30`년)

### 2.3 볼륨 구성
LabHub는 데이터 및 장기 보존 증빙의 유실을 방지하기 위해 다음과 같은 이름 있는 볼륨(Named Volume)을 사용합니다:
- `labhub_mongo_data`: MongoDB 데이터베이스 파일 (`/data/db`)
- `labhub_mongo_config`: MongoDB Replica Set 통신용 Keyfile 및 설정 (`/data/configdb`)
- `labhub_app_data`: 백엔드 로컬 데이터 디렉토리 전체 (`/app/backend/data`, 로컬 첨부파일 `uploads/`, 봉인 증빙 `seals/`, 로컬 키 `keys/` 영속화)
- `labhub_caddy_data`, `labhub_caddy_config`: Caddy TLS 인증서 및 프록시 설정

### 2.4 컨테이너 빌드 및 실행
```bash
# 컨테이너 빌드 및 백그라운드 구동
docker compose -f deploy/docker-compose.yml up -d --build

# 실행 상태 및 헬스체크 확인
docker compose -f deploy/docker-compose.yml ps
```

모든 서비스(`mongo`, `app`, `proxy`)의 Status가 `healthy` 상태로 전환될 때까지 대기합니다 (약 30초~1분 소요).

---

## 3. 최초 관리자 계정 생성 (Setup Token)

LabHub 서비스가 최초 기동된 직후에는 등록된 관리자 계정이 존재하지 않습니다. `.env`에 정의한 `SETUP_TOKEN`을 이용하여 최초 시스템 관리자를 생성합니다.

### 3.1 초기 설정 API 호출 예시
```bash
curl -X POST https://<APP_DOMAIN>/api/auth/setup \
  -H "Content-Type: application/json" \
  -H "X-LabHub-Request: 1" \
  -d '{
    "setupToken": "YOUR_SETUP_TOKEN_HERE",
    "email": "admin@lab.ac.kr",
    "password": "InitialSecurePassword123!",
    "name": "시스템관리자"
  }'
```

성공 응답을 확인한 후 브라우저에서 `https://<APP_DOMAIN>`에 접속하여 로그인합니다.

> [!IMPORTANT]
> 최초 관리자 등록이 완료되면, 보안을 위해 `deploy/.env`의 `SETUP_TOKEN` 값을 제거하거나 무효화하고 서비스를 재시작하는 것을 권장합니다.

---

## 4. 확장 기능 연동 및 상세 구성 가이드

### 4.1 S3 객체 스토리지 연동 (`STORAGE_PROVIDER=s3`)
기본 로컬 디스크 저장소(`STORAGE_PROVIDER=local`) 대신 AWS S3, Cloudflare R2, MinIO 등 S3 호환 객체 스토리지를 첨부파일 및 봉인 PDF의 주 저장소로 연동할 수 있습니다.

```bash
# deploy/.env 설정
STORAGE_PROVIDER=s3
MAX_UPLOAD_MB=200
S3_ENDPOINT=https://s3.example.org        # AWS S3 사용 시 비워두거나 생략
S3_BUCKET=labhub-storage
S3_REGION=ap-northeast-2
S3_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_KEY
S3_FORCE_PATH_STYLE=false                 # MinIO 사용 시 true로 설정
```

- **안전성**: 첨부파일 및 봉인 문서는 스트리밍 방식으로 업로드되며, SHA-256 해시가 데이터베이스 레코드와 일치하는지 상시 검증됩니다.

### 4.2 OIDC 단일 로그인(SSO) 연동 (`OIDC_ISSUER`)
기관의 기존 계정 체계(Keycloak, Okta, Google Workspace 등)와 연동하여 편리하고 안전한 통합 인증을 제공합니다.

```bash
# deploy/.env 설정 (4개 항목 모두 설정 시 OIDC 활성화)
OIDC_ISSUER=https://auth.example.ac.kr
OIDC_CLIENT_ID=labhub-client
OIDC_CLIENT_SECRET=your-oidc-client-secret
OIDC_REDIRECT_URI=https://<APP_DOMAIN>/api/auth/oidc/callback
OIDC_LABEL=대학/연구원 포털 계정
```

> [!WARNING]
> **OIDC 최초 로그인 시 로컬 비밀번호 차단 정책 (`ssoOnly: true`)**:
> 사용자가 등록된 이메일로 최초 OIDC 로그인을 수행하면, 시스템은 계정 도용 및 우회 로그인을 방지하기 위해 해당 사용자의 계정에 `ssoOnly: true` 플래그를 설정합니다. **이후 해당 계정은 로컬 이메일/비밀번호 로그인이 즉시 비활성화**되며, 오직 승인된 기관 OIDC 인증을 통해서만 시스템에 접근할 수 있습니다.

### 4.3 API 키 및 분석 장비 에이전트 (`@labhub/instrument-agent`)
HPLC, GC-MS, 분광기 등 연구실 분석 장비 PC에서 생성되는 결과 파일을 LabHub에 자동으로 수집·보존하기 위한 연동을 지원합니다.

1. **API 키 발급**: 시스템 관리자 또는 연구원이 LabHub 웹 화면(`설정 > API 키`)에서 장비별 전용 API 키를 발급받습니다.
   - 속도 제한: `API_KEY_RATE_LIMIT=120` (기본값 분당 120회)
2. **에이전트 실행**: 분석 장비 PC에 `@labhub/instrument-agent`를 설치하고 `config.json`을 작성하여 실행합니다.
   ```bash
   node bin/labhub-agent.js --config config.json
   ```
   - **무의존성 및 원본 불변성 보장**: Node.js 24 내장 모듈만으로 동작하며, 원본 장비 데이터 파일은 항상 읽기 전용(`r`)으로만 접근하여 절대 수정·삭제되지 않습니다. 지정된 안정화 시간(`stableSec`) 동안 파일 쓰기가 완료된 것만 검증 후 스트리밍 전송합니다.
3. **인박스(Inbox) 수신**: 수신된 장비 데이터는 `POST /api/v1/inbox/files`로 접수되어 인박스 목록에서 확인하고 전자연구노트에 원클릭으로 첨부할 수 있습니다.

### 4.4 웹훅 (Webhooks)
LabHub에서 발생하는 주요 라이프사이클 이벤트를 외부 연구실 메신저(Slack, Teams), LIMS 외부 시스템 또는 워크플로 엔진으로 실시간 전달할 수 있습니다.

- **지원 이벤트**:
  - `note.approved`: 연구노트 점검자 승인 및 전자봉인 완료 시
  - `note.rejected`: 연구노트 점검자 반려 시
  - `inbox.received`: 분석 장비 에이전트로부터 신규 측정 파일 수신 완료 시
- **보안 검증**: 관리자가 등록한 웹훅 Secret을 사용하여 전송 페이로드에 대한 HMAC-SHA256 서명 헤더(`X-LabHub-Signature`)가 전송되므로, 수신 서버는 위변조 여부를 확실하게 검증할 수 있습니다.

### 4.5 이메일 알림 및 계정 초대 (`MAIL_PROVIDER=smtp`)
신규 연구원 계정 초대 링크 발송, 비밀번호 재설정 및 결재 알림을 위한 이메일 발송 기능을 설정할 수 있습니다.

```bash
# deploy/.env 설정 (기본값: MAIL_PROVIDER=none)
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@lab.ac.kr
SMTP_PASSWORD=your_smtp_password
MAIL_FROM=LabHub <noreply@lab.ac.kr>
PUBLIC_BASE_URL=https://<APP_DOMAIN>
```

### 4.6 AI 연구 지원 기능 (`AI_PROVIDER=none`)
Claude 기반의 연구노트 초안 작성, 프로토콜 단계별 구조화, 표 추출, 체크리스트 검증 및 연구 질의응답 기능을 선택적으로 활용할 수 있습니다.

> [!IMPORTANT]
> **기본 비활성화(Off by default) 및 대외 데이터 전송 안내**:
> - AI 기능은 기본적으로 비활성화(`AI_PROVIDER=none`)되어 있으며, 서버 기동 시 어떠한 API 키도 요구하지 않습니다.
> - `AI_PROVIDER=anthropic`을 활성화할 경우, 사용자가 작성 중인 **프롬프트 텍스트, 연구노트 본문 및 질의 내용이 암호화된 HTTPS 통신을 통해 외부 Anthropic API 서버(`api.anthropic.com`)로 전송**됩니다.
> - 따라서 미공개 연구 데이터, 지식재산권(특허) 출원 전 데이터, 영업비밀의 외부 클라우드 전송에 대한 기관 자체 보안 규정 및 정책 승인을 반드시 선행한 후 활성화하십시오.

```bash
# deploy/.env 설정
AI_PROVIDER=anthropic
AI_MODEL=claude-opus-5-5
AI_EFFORT=medium
AI_RATE_LIMIT=10
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 4.7 서버 검색 엔진 (`SEARCH_PROVIDER=memory|meilisearch`)
- 기본값: `SEARCH_PROVIDER=memory` (프로세스 내장 인메모리 한국어 바이그램 인덱스). 소규모 연구실이나 단일 서버 인스턴스에서 외부 의존성 없이 즉시 동작합니다.
- 대규모 운영 환경(노트 1만 건 이상 또는 멀티 서버): `SEARCH_PROVIDER=meilisearch`로 지정하고 전용 Meilisearch 컨테이너를 연동하여 고속 검색을 지원합니다.

### 4.8 시점인증 (TSA: Time Stamping Authority)
- 기본값: `TIMESTAMP_PROVIDER=none` (기본 비활성화). 시점인증 없이도 LabHub 내부의 Ed25519 전자서명과 해시 봉인은 완결됩니다.
- 국제 표준 공인 TSA 연동 시: `TIMESTAMP_PROVIDER=rfc3161` (세부 설정은 [docs/guides/timestamp.md](timestamp.md) 참조).

---

## 5. 서비스 상태 점검 및 로그 확인

```bash
# 전체 컨테이너 로그 실시간 확인
docker compose -f deploy/docker-compose.yml logs -f

# 앱 컨테이너 로그만 확인
docker compose -f deploy/docker-compose.yml logs -f app

# 헬스체크 상태 직접 질의
curl -i https://<APP_DOMAIN>/api/health
```

---

## 6. 업그레이드 절차

시스템 업데이트 시 데이터 손실을 방지하기 위해 반드시 백업을 선행한 후 진행합니다.

```bash
# 1. 작업 전 백업 실행
./deploy/scripts/backup.sh

# 2. 최신 코드 가져오기
git fetch origin
git checkout <target-version-tag>

# 3. 신규 이미지 빌드 및 컨테이너 갱신 (무중단/최소 다운타임)
docker compose -f deploy/docker-compose.yml build app
docker compose -f deploy/docker-compose.yml up -d --no-deps app

# 4. 서비스 헬스체크 및 정상 구동 확인
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs --tail=100 app
```

---

## 7. 롤백 절차

업그레이드 후 심각한 오류가 발생하거나 이전 버전으로 복귀해야 하는 경우의 절차입니다.

```bash
# 1. 이전 안정 버전 태그/커밋으로 코드 체크아웃
git checkout <previous-stable-tag>

# 2. 이전 버전으로 이미지 재빌드 및 배포
docker compose -f deploy/docker-compose.yml up -d --build app

# 3. (데이터베이스 롤백이 필요한 경우)
# 서비스 임시 중단
docker compose -f deploy/docker-compose.yml stop app

# 백업 복구 절차 수행 (docs/guides/backup-restore.md 참조)
# 빈 데이터베이스 환경에서 복원 스크립트 실행
# 서비스 재개
docker compose -f deploy/docker-compose.yml start app
```

---

## 8. 대규모 데이터 및 성능 부하 테스트

운영 전 대규모 데이터 환경에서의 성능 및 동시성 처리를 사전에 검증하려면 [docs/guides/loadtest.md](loadtest.md) 가이드를 참조하세요. 일회용 격리 스택 환경에서 안전하게 부하 테스트를 수행할 수 있습니다.
