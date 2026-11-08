# 정기 백업 및 복구 가이드

본 문서는 LabHub 전자연구노트 데이터의 정기 백업, 자동화 스크립트 운용, 복구 리허설 및 핵심 암호화 키 관리 방안을 안내합니다.

> [!NOTE]
> LabHub의 백업·복원 시스템은 `backend/scripts/backup.js` 및 `deploy/scripts/`를 통해 동작합니다. 핵심 보안 및 증빙 컬렉션(`NoteSeal`, `AuditAnchor`, `UserSigningKey`, `ApiKey`, `Webhook` 등)과 장기 보존용 PDF는 백업 대상에 포함되도록 구성되어 있습니다.

---

## 1. 백업 데이터 구조와 무결성

LabHub의 백업은 단순한 DB 덤프가 아니며, 데이터베이스 레코드와 업로드 첨부파일을 묶어 SHA-256 해시로 봉인한 자족적 패키지입니다.

### 백업 폴더 구조
```text
labhub-backup-20261108_180000/
├── manifest.json       # 백업 메타데이터, 버전, 레코드 해시, 파일별 해시/크기 목록
├── records.json        # MongoDB 전체 컬렉션 문서 (EJSON 표준 직렬화)
└── files/              # 업로드 첨부파일 원본 (첨부 ID 파일명)
    ├── 672da1...
    └── 672da2...
```

### 무결성 검증 원칙
- **스냅샷 트랜잭션 백업**: MongoDB readConcern `snapshot` 트랜잭션을 통해 일관된 시점의 데이터를 추출합니다.
- **첨부파일 변조 감지**: 백업 생성 시 첨부파일의 SHA-256 해시를 계산하여 DB 기록과 불일치할 경우 백업이 즉시 중단됩니다.
- **레코드 해시 검증**: 복원 시 `records.json`의 해시와 `manifest.json`의 `recordsHash`를 대조하여 1비트의 손상도 허용하지 않습니다.

---

## 2. 정기 백업 실행 및 예약 설정

Docker Compose 환경에서 호스트는 컨테이너 내부의 MongoDB 포트(`27017`)나 볼륨에 직접 접근할 수 없으므로, `deploy/scripts/backup.sh`는 `docker compose exec -T app`을 통해 `app` 컨테이너 내부에서 백업을 실행합니다. 생성된 백업은 컨테이너에 마운트된 `/backups`(호스트의 `deploy/backups/`) 디렉토리에 영속화됩니다.

### 2.1 수동 백업 실행
```bash
# 호스트에서 백업 스크립트 실행
./deploy/scripts/backup.sh
```

### 2.2 크론탭(crontab)을 이용한 일일 자동 백업 등록
매일 새벽 2시에 백업을 수행하고 30일간 보존하도록 설정하는 예시입니다:

```bash
# crontab -e
0 2 * * * cd /opt/labhub && RETENTION_COUNT=30 ./deploy/scripts/backup.sh >> /var/log/labhub-backup.log 2>&1
```

> [!TIP]
> 백업 스크립트는 `labhub-backup-YYYYMMDD_HHMMSS` 형식의 폴더만 정리 대상으로 인식하므로, 수동으로 생성한 다른 파일이나 폴더는 실수로 삭제되지 않습니다.

---

## 3. 복구 리허설 (Restore Rehearsal)

복구 리허설은 **"실제 장애가 발생했을 때 백업본으로 완벽히 복원할 수 있는가?"**를 주기적으로 검증하는 필수 운영 절차입니다.

### 3.1 복구 리허설 스크립트 실행
```bash
# 최신 백업본 자동 리허설
./deploy/scripts/restore-rehearsal.sh

# 특정 백업 디렉토리 지정 리허설
./deploy/scripts/restore-rehearsal.sh /var/backups/labhub/labhub-backup-20261108_180000
```

### 3.2 리허설 스크립트의 안전 보장 원칙
1. **기존 운영 환경 무영향**: 운영 중인 Docker 컨테이너와 볼륨에는 일체 접근하지 않습니다.
2. **독립된 포트 격리**: 임시 포트(기본 `27099`)로 `mongod`를 직접 기동하고 Replica Set 멤버 주소 역시 `127.0.0.1:27099`로 등록하여 로컬의 기존 MongoDB 인스턴스와 완전히 격리합니다.
3. **완전 복원 및 정밀 대조**:
   - `manifest.json`에 정의된 첨부파일 건수 대조
   - `records.json`의 컬렉션별 문서 수와 복원된 MongoDB 컬렉션의 실제 문서 수(`countDocuments()`) 전수 일치 검증
4. **자동 정리(`trap`)**: 정상 완료 또는 스크립트 강제 중단 시에도 임시 컨테이너, 볼륨, 디스크 디렉토리를 100% 자동 정리합니다.

---

## 4. 운영 환경 실제 복원 절차

재해 복구 또는 서버 이전 시 실제 운영 환경으로 복원하는 절차입니다.

> [!IMPORTANT]
> **빈 데이터베이스 제약조건**:
> 데이터 정합성 보장을 위해 LabHub 복원 스크립트는 **컬렉션이 완전히 비어 있는 데이터베이스에만 복원을 허용**합니다. 기존 데이터가 존재하면 오류와 함께 거부됩니다.

```bash
# 1. 애플리케이션 서비스 중지
docker compose -f deploy/docker-compose.yml stop app

# 2. 복원 스크립트 호출 (백엔드 스크립트 실행)
docker compose -f deploy/docker-compose.yml run --rm \
  -e MONGO_URI="mongodb://${MONGO_APP_USERNAME}:${MONGO_APP_PASSWORD}@mongo:27017/${DB_NAME}?replicaSet=rs0&authSource=${DB_NAME}" \
  -e DATA_DIR="/app/backend/data" \
  app node scripts/backup.js restore /backups/labhub-backup-YYYYMMDD_HHMMSS

# 3. 애플리케이션 서비스 재기동
docker compose -f deploy/docker-compose.yml start app
```

---

## 5. 핵심 보안 키 분실 시 영향 분석

LabHub 시스템은 연구노트의 진본성 및 계정 보안을 위해 여러 계층의 암호화 키를 사용합니다. 키 분실 시 시스템에 미치는 영향을 숙지하고 별도의 안전한 오프라인 매체(금고, HSM 등)에 백업해 두어야 합니다.

### 5.1 `JWT_SECRET` 분실 시 영향
- **발생 영향**:
  - 기존 발급된 모든 세션 쿠키(`labhub_session`) 및 토큰이 즉시 무효화됩니다.
  - 모든 사용자가 즉시 로그아웃되며, 재로그인해야 합니다.
- **데이터 보존 영향**:
  - 데이터베이스의 연구노트, 서명, 감사로그에는 아무런 영향이 없습니다.
- **복구 방안**: 새로운 32자 이상의 임의 문자열을 생성하여 교체 후 재시작하면 서비스가 정상화됩니다.

### 5.2 `DATA_ENCRYPTION_KEY` 분실 시 영향
- **성격**: 32바이트 Base64 문자열 (`openssl rand -base64 32`)
- **용도**: MFA(TOTP) 비밀키 등 서버 측 데이터 암호화(AES-256-GCM)에 사용됩니다.
  *(참고: 사용자 서명 개인키는 이 키가 아니라 사용자 비밀번호에서 scrypt로 유도한 키로 암호화됩니다.)*
- **분실 시 영향**:
  - MFA를 활성화한 사용자가 TOTP 코드로 로그인할 수 없게 됩니다 (일회용 복구 코드로 로그인 필요).
  - 관리자가 해당 사용자의 MFA를 재설정해야 합니다.
  - 기존 서명된 연구노트의 서명 공개키 검증(Ed25519 공개키)에는 영향을 미치지 않습니다.
- **관리 수칙**:
  - `DATA_ENCRYPTION_KEY`는 초기 배포 시 오프라인 안전 매체에 백업해 두어야 합니다.
