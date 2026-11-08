#!/bin/bash
# ==============================================================================
# LabHub 복구 리허설 자동화 스크립트 (deploy/scripts/restore-rehearsal.sh)
#
# 격리된 임시 MongoDB 컨테이너를 지정된 임시 포트(${REHEARSAL_PORT})로 실행하여,
# 로컬 기존 MongoDB 인스턴스와 완전히 분리된 상태에서 백업본의 복원 무결성을 검증합니다.
# 검증 항목: 컬렉션별 레코드 수 일치 및 첨부파일 건수/크기 대조.
# 검증 완료 후 모든 임시 컨테이너, 볼륨, 디렉토리는 trap을 통해 자동 정리됩니다.
# ==============================================================================
set -eo pipefail

export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BACKEND_DIR="${PROJECT_ROOT}/backend"
BACKUP_INPUT="$1"

# 1. 백업본 절대 경로 확인
if [ -n "${BACKUP_INPUT}" ]; then
    if [ ! -d "${BACKUP_INPUT}" ]; then
        echo "[ERROR] 지정한 백업 디렉토리가 존재하지 않습니다: ${BACKUP_INPUT}" >&2
        exit 1
    fi
    BACKUP_PATH="$(cd "${BACKUP_INPUT}" && pwd)"
else
    BACKUP_ROOT="${BACKUP_ROOT_DIR:-${PROJECT_ROOT}/deploy/backups}"
    echo "[INFO] 백업 인자가 지정되지 않아 최신 백업을 검색합니다: ${BACKUP_ROOT}"
    PREFIX="labhub-backup-"
    LATEST_BACKUP=$(find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d -name "${PREFIX}*" 2>/dev/null | sort | tail -n 1 || true)
    if [ -z "${LATEST_BACKUP}" ]; then
        echo "[ERROR] 검증할 유효한 백업본을 찾을 수 없습니다." >&2
        echo "사용법: $0 <백업디렉토리경로>" >&2
        exit 1
    fi
    BACKUP_PATH="$(cd "${LATEST_BACKUP}" && pwd)"
fi

if [ ! -f "${BACKUP_PATH}/manifest.json" ] || [ ! -f "${BACKUP_PATH}/records.json" ]; then
    echo "[ERROR] 올바른 LabHub 백업 형식이 아닙니다 (manifest.json 또는 records.json 누락): ${BACKUP_PATH}" >&2
    exit 1
fi

echo "[INFO] 복구 리허설 대상 백업: ${BACKUP_PATH}"

# 2. 임시 식별자 및 자원 정의 (기존 27017/27028 포트와 절대 겹치지 않도록 분리)
RAND_ID="rehearsal-$$"
CONTAINER_NAME="labhub-mongo-${RAND_ID}"
VOLUME_NAME="labhub_vol_${RAND_ID}"
REHEARSAL_PORT="${REHEARSAL_PORT:-27099}"
TEMP_DATA_DIR=$(mktemp -d -t labhub-rehearsal-data-XXXXXX 2>/dev/null || mktemp -d 2>/dev/null || echo "/tmp/labhub-${RAND_ID}")
mkdir -p "${TEMP_DATA_DIR}"

# 3. 종료 시 임시 자원 정리 (정상/오류 관계없이 반드시 실행)
cleanup() {
    EXIT_CODE=$?
    echo "[CLEANUP] 복구 리허설 임시 자원 정리 시작..."
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
        docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
        docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    fi
    docker volume rm -f "${VOLUME_NAME}" >/dev/null 2>&1 || true
    if [ -d "${TEMP_DATA_DIR}" ]; then
        rm -rf "${TEMP_DATA_DIR}" >/dev/null 2>&1 || true
    fi
    echo "[CLEANUP] 임시 컨테이너, 볼륨, 디렉토리 정리 완료."
    exit ${EXIT_CODE}
}
trap cleanup EXIT INT TERM

# 4. 임시 MongoDB 단일 노드 Replica Set 컨테이너 기동
echo "[INFO] 임시 MongoDB 컨테이너 기동 중 (포트: ${REHEARSAL_PORT}, 컨테이너: ${CONTAINER_NAME})..."
docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${REHEARSAL_PORT}:${REHEARSAL_PORT}" \
    -v "${VOLUME_NAME}:/data/db" \
    mongo:7.0 \
    mongod --port "${REHEARSAL_PORT}" --replSet rs_rehearsal --bind_ip_all

# 연결 수락 대기
echo "[INFO] MongoDB 가용 상태 대기..."
for i in {1..30}; do
    if docker exec "${CONTAINER_NAME}" mongosh --port "${REHEARSAL_PORT}" --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        echo "[ERROR] 임시 MongoDB 컨테이너 응답 시간 초과!" >&2
        exit 1
    fi
done

# Replica Set 초기화 (멤버 주소를 127.0.0.1:REHEARSAL_PORT 로 등록)
echo "[INFO] 임시 Replica set (rs_rehearsal) 초기화..."
docker exec "${CONTAINER_NAME}" mongosh --port "${REHEARSAL_PORT}" --quiet --eval \
    'rs.initiate({ _id: "rs_rehearsal", members: [{ _id: 0, host: "127.0.0.1:'"${REHEARSAL_PORT}"'" }] })' >/dev/null 2>&1

# Primary 대기
for i in {1..30}; do
    IS_PRIMARY=$(docker exec "${CONTAINER_NAME}" mongosh --port "${REHEARSAL_PORT}" --quiet --eval "Boolean(db.hello().isWritablePrimary)" 2>/dev/null || echo "false")
    if [ "${IS_PRIMARY}" = "true" ]; then
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        echo "[ERROR] Primary 선출 시간 초과!" >&2
        exit 1
    fi
done
echo "[INFO] 임시 MongoDB 준비 완료."

# Windows 호스트 node.exe 실행을 위해 경로 정규화 (cygpath 사용 가능 시 변환)
NODE_DATA_DIR="${TEMP_DATA_DIR}"
NODE_BACKUP_PATH="${BACKUP_PATH}"
NODE_BACKEND_DIR="${BACKEND_DIR}"
if command -v cygpath >/dev/null 2>&1; then
    NODE_DATA_DIR="$(cygpath -w "${TEMP_DATA_DIR}")"
    NODE_BACKUP_PATH="$(cygpath -w "${BACKUP_PATH}")"
    NODE_BACKEND_DIR="$(cygpath -w "${BACKEND_DIR}")"
fi

# 5. 백업 복원 실행 (backend/scripts/backup.js restore)
echo "[INFO] backend/scripts/backup.js restore 실행..."
export MONGO_URI="mongodb://127.0.0.1:${REHEARSAL_PORT}/?replicaSet=rs_rehearsal"
export DB_NAME="rehearsal_db"
export DATA_DIR="${NODE_DATA_DIR}"

RESTORE_OUTPUT=$(node "${NODE_BACKEND_DIR}\\scripts\\backup.js" restore "${NODE_BACKUP_PATH}")
echo "[INFO] 복원 출력: ${RESTORE_OUTPUT}"

# 6. 정밀 건수 검증 (첨부파일 수 + 컬렉션별 문서 수 대조)
echo "[INFO] 정밀 건수 대조 검증 수행 중..."

# 6.1 첨부파일 건수 대조
MANIFEST_FILE_COUNT=$(node -e "const fs = require('fs'); const m = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(m.files.length);" "${NODE_BACKUP_PATH}\\manifest.json")
RESTORED_FILES=$(find "${TEMP_DATA_DIR}/uploads" -type f 2>/dev/null | wc -l || echo 0)
echo "[INFO] 첨부파일 수 검증: 백업 매니페스트=${MANIFEST_FILE_COUNT}, 복원된 파일=${RESTORED_FILES}"

if [ "${MANIFEST_FILE_COUNT}" -ne "${RESTORED_FILES}" ]; then
    echo "[ERROR] 첨부파일 수량 불일치로 복구 리허설 실패!" >&2
    exit 1
fi

# 6.2 컬렉션별 문서 수 대조 (backend 디렉토리 내에서 node 실행하여 mongoose 패키지 해결)
VALIDATION_SCRIPT="
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

const payload = await readFile(path.join(process.env.BACKUP_PATH_DIR, 'records.json'), 'utf8');
const { EJSON } = mongoose.mongo.BSON;
const records = EJSON.parse(payload);

await mongoose.connect('${MONGO_URI}', { dbName: '${DB_NAME}' });
try {
  let hasMismatch = false;
  for (const [colName, docs] of Object.entries(records)) {
    if (!Array.isArray(docs)) continue;
    const actualCount = await mongoose.connection.db.collection(colName).countDocuments();
    const expectedCount = docs.length;
    console.log(\`  - 컬렉션 [\${colName}]: 예상 \${expectedCount}건 / 실제 \${actualCount}건\`);
    if (actualCount !== expectedCount) {
      console.error(\`[ERROR] 컬렉션 [\${colName}] 문서 수 불일치! (예상: \${expectedCount}, 실제: \${actualCount})\`);
      hasMismatch = true;
    }
  }
  if (hasMismatch) process.exit(1);
} finally {
  await mongoose.disconnect();
}
"

if ! (cd "${BACKEND_DIR}" && BACKUP_PATH_DIR="${NODE_BACKUP_PATH}" node --input-type=module -e "${VALIDATION_SCRIPT}"); then
    echo "[ERROR] 컬렉션별 문서 건수 검증 실패!" >&2
    exit 1
fi

echo "=============================================================================="
echo "[SUCCESS] 복구 리허설이 성공적으로 완료되었습니다."
echo "- 검증 백업본: ${BACKUP_PATH}"
echo "- 첨부파일 검증: ${RESTORED_FILES}개 정상 대조 완료"
echo "- 컬렉션 문서 수: records.json 전수 대조 일치"
echo "=============================================================================="
exit 0
