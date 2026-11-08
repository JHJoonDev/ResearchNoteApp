# 대규모 데이터 및 성능 부하 테스트 가이드 (Load Testing Guide)

본 문서는 `tools/loadtest` 도구를 사용하여 LabHub 시스템의 대용량 데이터 시딩(기본 1만 건) 및 핵심 9대 시나리오의 처리량(Throughput), 응답 지연 시간(p50/p95/p99), 에러율 및 레이트 리밋 영향을 측정하는 절차를 안내합니다.

> [!CAUTION]
> 본 도구는 데이터베이스에 대량의 레코드(사용자, 프로젝트, 노트, 시약, 첨부파일 등)를 실제로 생성합니다. 프로덕션 환경이나 데이터 유실 위험이 있는 환경에서 실수로 실행되는 것을 방지하기 위해 **반드시 대상 호스트가 `localhost` 또는 `127.0.0.1`이어야 하며, `--i-know-this-writes-data` 플래그를 명시해야만 실행**됩니다.

---

## 1. 테스트 환경 준비 (독립된 일회용 스택 구성)

기존 운영 또는 개발 컨테이너/볼륨에 영향을 주지 않도록, 비표준 포트와 별도의 프로젝트 이름을 사용하여 일회용 검증 스택을 띄웁니다.

```bash
# 1. 일회용 검증 스택 실행 (HTTP 18080, HTTPS 18443 포트)
HTTP_PORT=18080 \
HTTPS_PORT=18443 \
JWT_SECRET=$(openssl rand -hex 32) \
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) \
SETUP_TOKEN=test_setup_token \
MONGO_ROOT_USERNAME=admin \
MONGO_ROOT_PASSWORD=$(openssl rand -hex 32) \
MONGO_APP_PASSWORD=$(openssl rand -hex 32) \
docker compose -f deploy/docker-compose.yml --project-name labhub-loadtest up -d --build

# 2. 스택 헬스체크 확인
curl -i http://127.0.0.1:18080/api/health
```

---

## 2. 부하 테스트 실행 방법

### 2.1 스모크 테스트 (소규모 검증, 약 200건)
시스템 기본 동작 및 엔드포인트 규격을 소규모 데이터로 빠르게 점검합니다.

```bash
node tools/loadtest/bin/run-loadtest.js \
  --i-know-this-writes-data \
  --target http://127.0.0.1:18080 \
  --notes 200 \
  --users 5 \
  --projects 3 \
  --concurrency 5 \
  --duration 5
```

### 2.2 대규모 부하 테스트 (기본 10,000건 시딩)
```bash
node tools/loadtest/bin/run-loadtest.js \
  --i-know-this-writes-data \
  --target http://127.0.0.1:18080 \
  --notes 10000 \
  --users 20 \
  --projects 10 \
  --reagents 50 \
  --concurrency 20 \
  --duration 30 \
  --output-json loadtest-10k.json \
  --output-md loadtest-10k.md
```

---

## 3. 측정 대상 9대 핵심 시나리오

1. **`login`**: `POST /api/auth/login` (세션 발급 및 `express-rate-limit` 15분당 100회 초과 시 429 감지)
2. **`paged-note-list`**: `GET /api/eln?page=1&limit=20&sort=-updatedAt` (서버 페이지네이션 및 필터링)
3. **`open-note`**: `GET /api/eln/:id` (본문, 첨부파일 목록, 서명 메타데이터 전체 로딩)
4. **`save-with-version-check`**: `PUT /api/eln/:id` (ProseMirror note-format 구조화 본문 저장 및 낙관적 동시성 버전 검증)
5. **`search`**: `GET /api/search?q=...` (서버 검색 엔진 질의 및 스니펫 텍스트 반환)
6. **`review-queue`**: `GET /api/eln/review-queue?page&limit` (검토 대기열 조회)
7. **`approve-with-signing`**: 임시 노트 생성 -> 작성자 서명 요청 -> 점검자 Ed25519 전자서명 승인 및 무결성 봉인(PDF 생성)
8. **`audit-page`**: `GET /api/audit?page&limit` (관리자 권한 감사 로그 체인 페이징 조회)
9. **`verify-endpoint`**: `GET /api/public/verify/:verifyId` (외부 일반 사용자용 공개 봉인 검증 엔드포인트)

---

## 4. 리포트 출력 및 레이트 리밋 주의사항

- 테스트 완료 시 해당 실행 환경에서 측정된 처리량(RPS), 레이턴시 백분위수(`min`, `p50`, `p95`, `p99`, `max`), 에러율(%)이 포함된 JSON 및 Markdown 리포트가 자동 생성됩니다.
- 본 도구는 대상 환경의 부하 성능을 측정하는 **실행 방법(Method Guide)**을 제공하며, 시스템의 고정된 공인 벤치마크 수치를 주장하지 않습니다. 성능 수치는 호스트의 하드웨어 사양, CPU 코어 수, 디스크 I/O 속도 및 네트워크 환경에 따라 상이합니다.
- **레이트 리밋 영향**: 시스템 보안 설정으로 인해 `/api/auth/login`(15분당 100회) 및 `/api/public/verify`(15분당 60회)에 Rate Limiting이 적용되어 있습니다. 부하 테스트 중 임계치를 초과하여 HTTP 429가 발생하면 리포트에 `rateLimitDistorted: true`가 표시되며, 이는 서버 결함이 아닌 보안 가드가 정상 동작한 결과입니다. 정밀 측정을 위해 `--pace-verify` 옵션을 사용하거나 테스트용 설정을 조정할 수 있습니다.

---

## 5. 테스트 스택 및 자원 정리

테스트 완료 후 생성된 일회용 컨테이너와 볼륨을 완전히 정리합니다:

```bash
docker compose -f deploy/docker-compose.yml --project-name labhub-loadtest down -v --rmi local
```
