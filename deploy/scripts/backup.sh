#!/bin/bash
# ==============================================================================
# LabHub 예약 백업 자동화 스크립트 (deploy/scripts/backup.sh)
#
# Docker Compose 환경의 app 컨테이너 내부에서 backend/scripts/backup.js를 실행하여
# /backups 볼륨(호스트의 deploy/backups)에 백업을 생성하고,
# 지정된 보존 개수(RETENTION_COUNT)를 초과하는 과거 백업 디렉토리를 정리합니다.
# ==============================================================================
set -eo pipefail

# Git Bash(MSYS) 환경에서 /backups 등의 경로가 Windows 드라이브 경로로 치환되는 현상 방지
export MSYS_NO_PATHCONV=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# 백업 파일이 저장될 호스트 디렉토리 (기본값: deploy/backups)
BACKUP_ROOT="${BACKUP_ROOT_DIR:-${PROJECT_ROOT}/deploy/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_ROOT}/deploy/docker-compose.yml}"

# 백업 보존 개수 (기본값: 14개)
RETENTION_COUNT="${RETENTION_COUNT:-14}"

mkdir -p "${BACKUP_ROOT}"

# 백업 디렉토리 명명 규칙 (예: labhub-backup-20261108_181500)
PREFIX="labhub-backup-"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_NAME="${PREFIX}${TIMESTAMP}"

echo "[INFO] 백업 시작: 대상 폴더명 -> ${BACKUP_NAME}"

# 1. 실행 환경 판별 및 백업 명령 실행
# Docker Compose 컨테이너 외부(호스트)에서 실행된 경우: docker compose exec 활용
if [ -f "${COMPOSE_FILE}" ] && docker compose -f "${COMPOSE_FILE}" ps -q app >/dev/null 2>&1 && [ "$(docker compose -f "${COMPOSE_FILE}" ps -q app)" != "" ]; then
    echo "[INFO] 호스트 환경 감지: app 컨테이너 내부에서 backup.js 실행..."
    if ! docker compose -f "${COMPOSE_FILE}" exec -T app node scripts/backup.js backup "/backups/${BACKUP_NAME}"; then
        echo "[ERROR] app 컨테이너 내 백업 실행 실패!" >&2
        exit 1
    fi
elif [ -d "/app/backend" ]; then
    # 컨테이너 내부에서 직접 실행된 경우
    echo "[INFO] 컨테이너 내부 환경 감지: 로컬에서 backup.js 실행..."
    if ! node /app/backend/scripts/backup.js backup "/backups/${BACKUP_NAME}"; then
        echo "[ERROR] 로컬 백업 실행 실패!" >&2
        exit 1
    fi
elif [ -d "${PROJECT_ROOT}/backend" ]; then
    # 로컬 개발 환경(컨테이너 미사용)
    echo "[INFO] 로컬 개발 환경 감지: backend/scripts/backup.js 실행..."
    if ! node "${PROJECT_ROOT}/backend/scripts/backup.js" backup "${BACKUP_ROOT}/${BACKUP_NAME}"; then
        echo "[ERROR] 백업 실행 실패!" >&2
        exit 1
    fi
else
    echo "[ERROR] 실행 가능한 LabHub 환경을 찾을 수 없습니다." >&2
    exit 1
fi

echo "[INFO] 백업 파일 생성 완료: ${BACKUP_ROOT}/${BACKUP_NAME}"

# ==============================================================================
# 2. 과거 백업 정리 (보존 개수 관리)
# 안전 조치: 스크립트가 생성한 명명 규칙 (${PREFIX}YYYYMMDD_HHMMSS)과 일치하는 폴더만 정리 대상으로 한정
# ==============================================================================
echo "[INFO] 과거 백업 디렉토리 정리 검사 (보존 개수: ${RETENTION_COUNT})..."

EXISTING_BACKUPS=()
while IFS= read -r dir; do
    [ -n "$dir" ] && EXISTING_BACKUPS+=("$dir")
done < <(find "${BACKUP_ROOT}" -maxdepth 1 -mindepth 1 -type d -name "${PREFIX}[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]" | sort)

TOTAL_COUNT=${#EXISTING_BACKUPS[@]}
echo "[INFO] 식별된 유효 백업본 수: ${TOTAL_COUNT}"

if [ "${TOTAL_COUNT}" -gt "${RETENTION_COUNT}" ]; then
    DELETE_COUNT=$((TOTAL_COUNT - RETENTION_COUNT))
    echo "[INFO] 보존 개수를 초과한 ${DELETE_COUNT}개의 오래된 백업을 삭제합니다."

    for ((i=0; i<DELETE_COUNT; i++)); do
        OLD_BACKUP="${EXISTING_BACKUPS[i]}"
        BASENAME="$(basename "${OLD_BACKUP}")"
        if [[ "${BASENAME}" =~ ^${PREFIX}[0-9]{8}_[0-9]{6}$ ]]; then
            echo "[INFO] 삭제: ${OLD_BACKUP}"
            rm -rf "${OLD_BACKUP}"
        else
            echo "[WARN] 정규식 패턴과 불일치하여 삭제를 건너뜁니다: ${OLD_BACKUP}"
        fi
    done
else
    echo "[INFO] 정리할 오래된 백업이 없습니다. (현재: ${TOTAL_COUNT} <= 보존: ${RETENTION_COUNT})"
fi

echo "[INFO] 예약 백업 작업이 성공적으로 완료되었습니다."
exit 0
