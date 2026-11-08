#!/usr/bin/env node

/**
 * @fileoverview LabHub 계측기 파일 업로더 CLI 실행 진입점
 */

import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { InstrumentAgent } from '../src/agent.js';
import { StateStore } from '../src/state.js';
import { logger } from '../src/logger.js';

function parseArgs(args) {
  const options = {
    configPath: './config.json',
    once: false,
    status: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && i + 1 < args.length) {
      options.configPath = args[++i];
    } else if (arg === '--once') {
      options.once = true;
    } else if (arg === '--status') {
      options.status = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
LabHub 계측기 파일 업로더 (Instrument Agent)

사용법:
  labhub-agent [옵션]

옵션:
  --config <경로>   설정 파일(JSON) 경로 지정 (기본값: ./config.json)
  --once           디렉토리를 1회 스캔 및 업로드 후 종료 (실패 시 비정상 종료 코드)
  --status         현재 큐 및 업로드 상태 집계를 출력하고 종료
  --help, -h       도움말 출력
`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  let config;
  try {
    config = loadConfig(options.configPath, { skipApiKey: options.status });
  } catch (err) {
    logger.error('설정 로드 실패', { error: err.message, configPath: options.configPath });
    process.exit(1);
  }

  // --status 모드
  if (options.status) {
    const state = new StateStore(config.stateDir, config.instrumentId);
    await state.init();
    const summary = state.getSummary();
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  const agent = new InstrumentAgent(config);

  // --once 모드
  if (options.once) {
    logger.info('--once 단회 실행 모드로 시작합니다.');
    const success = await agent.runOnce();
    if (!success) {
      logger.error('--once 실행 중 영구 실패 또는 인증 중단이 발생했습니다.');
      process.exit(1);
    }
    logger.info('--once 실행이 성공적으로 완료되었습니다.');
    process.exit(0);
  }

  // 데몬 모드
  const handleSignal = async (signal) => {
    logger.info(`${signal} 수신, 안전하게 종료 중...`);
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  await agent.start();
}

main().catch((err) => {
  logger.error('치명적 에러 발생', { error: err.message, stack: err.stack });
  process.exit(1);
});
