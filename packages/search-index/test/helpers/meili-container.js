/**
 * @fileoverview 일회용 Meilisearch 테스트 컨테이너 관리 헬퍼
 */

import { execSync, spawn } from 'node:child_process';

const CONTAINER_PORT = 17700;
const MEILI_IMAGE = 'getmeili/meilisearch:v1.12';
const MASTER_KEY = 'testMasterKey1234567890';

/**
 * Docker 데몬 사용 가능 여부를 검사합니다.
 * @returns {boolean}
 */
export function isDockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 격리된 일회용 Meilisearch 컨테이너를 기동합니다. (포트: 17700)
 * @returns {Promise<{ host: string, apiKey: string, stop: () => Promise<void> } | null>}
 */
export async function startMeiliContainer() {
  if (!isDockerAvailable()) {
    console.warn('[MeiliContainer] Docker 데몬을 사용할 수 없어 Meilisearch 테스트를 건너뜁니다.');
    return null;
  }

  const containerName = `labhub-meili-test-${Date.now()}`;
  console.log(`[MeiliContainer] 임시 컨테이너 기동 중: ${containerName} (포트: ${CONTAINER_PORT})...`);

  try {
    execSync(
      `docker run -d --rm --name ${containerName} -p ${CONTAINER_PORT}:7700 -e MEILI_MASTER_KEY=${MASTER_KEY} -e MEILI_NO_ANALYTICS=true ${MEILI_IMAGE}`,
      { stdio: 'ignore' }
    );
  } catch (e) {
    console.warn('[MeiliContainer] 컨테이너 시작 실패:', e.message);
    return null;
  }

  const host = `http://127.0.0.1:${CONTAINER_PORT}`;

  // 헬스체크 대기
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${host}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // 대기
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!ready) {
    console.warn('[MeiliContainer] 컨테이너 헬스체크 시간 초과! 컨테이너를 정리합니다.');
    try {
      execSync(`docker stop ${containerName}`, { stdio: 'ignore' });
    } catch {}
    return null;
  }

  console.log('[MeiliContainer] Meilisearch 준비 완료.');

  const stop = async () => {
    console.log(`[MeiliContainer] 임시 컨테이너 정리: ${containerName}...`);
    try {
      execSync(`docker stop ${containerName}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('[MeiliContainer] 정리 실패:', e.message);
    }
  };

  return {
    host,
    apiKey: MASTER_KEY,
    stop,
  };
}
