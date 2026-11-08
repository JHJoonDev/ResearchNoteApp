import { URL } from 'node:url';

/**
 * CLI 인자 파싱 및 안전 점검
 * @param {string[]} args
 */
export function parseConfig(args = process.argv.slice(2)) {
  const options = {
    target: 'http://127.0.0.1:18080',
    setupToken: process.env.SETUP_TOKEN || 'test_setup_token',
    notes: 10000,
    users: 5,
    projects: 3,
    reagents: 10,
    attachments: 5,
    concurrency: 5,
    durationSec: 10,
    iKnowThisWritesData: false,
    seedOnly: false,
    skipSeed: false,
    outputJson: 'loadtest-report.json',
    outputMd: 'loadtest-report.md',
    verbose: false,
    scenarios: null,
    paceVerify: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--i-know-this-writes-data') {
      options.iKnowThisWritesData = true;
    } else if (arg === '--target' || arg === '-t') {
      options.target = args[++i];
    } else if (arg === '--setup-token') {
      options.setupToken = args[++i];
    } else if (arg === '--notes' || arg === '-n') {
      options.notes = Math.max(1, parseInt(args[++i], 10) || 10000);
    } else if (arg === '--users' || arg === '-u') {
      options.users = Math.max(2, parseInt(args[++i], 10) || 5);
    } else if (arg === '--projects' || arg === '-p') {
      options.projects = Math.max(1, parseInt(args[++i], 10) || 3);
    } else if (arg === '--reagents' || arg === '-r') {
      options.reagents = Math.max(1, parseInt(args[++i], 10) || 10);
    } else if (arg === '--attachments' || arg === '-a') {
      options.attachments = Math.max(0, parseInt(args[++i], 10) || 5);
    } else if (arg === '--concurrency' || arg === '-c') {
      options.concurrency = Math.max(1, parseInt(args[++i], 10) || 5);
    } else if (arg === '--duration' || arg === '-d') {
      options.durationSec = Math.max(1, parseInt(args[++i], 10) || 10);
    } else if (arg === '--seed-only') {
      options.seedOnly = true;
    } else if (arg === '--skip-seed') {
      options.skipSeed = true;
    } else if (arg === '--output-json') {
      options.outputJson = args[++i];
    } else if (arg === '--output-md') {
      options.outputMd = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--scenarios' || arg === '-s') {
      options.scenarios = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--pace-verify') {
      options.paceVerify = true;
    } else if (arg === '--no-pace-verify') {
      options.paceVerify = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  validateConfig(options);
  return options;
}

/**
 * 안전성 검증:
 * 1. 대상 호스트는 반드시 localhost 또는 127.0.0.1 이어야 함.
 * 2. 명시적 --i-know-this-writes-data 플래그가 필수.
 * @param {object} options
 */
export function validateConfig(options) {
  if (!options.iKnowThisWritesData) {
    throw new Error(
      '안전 가드 발동: 대량 데이터 작성을 방지하기 위해 --i-know-this-writes-data 플래그를 반드시 명시해야 실행됩니다.'
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(options.target);
  } catch (err) {
    throw new Error(`대상 URL이 올바르지 않습니다: ${options.target} (${err.message})`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

  if (!allowedHosts.has(hostname)) {
    throw new Error(
      `안전 가드 발동: 부하 테스트 대상은 오직 로컬 환경(localhost, 127.0.0.1)만 허용됩니다. 대상 호스트: ${hostname}`
    );
  }
}

function printHelp() {
  console.log(`
LabHub HTTP 부하 테스트 도구 (@labhub/loadtest)

사용법:
  node bin/run-loadtest.js --i-know-this-writes-data [옵션]

필수 플래그:
  --i-know-this-writes-data   대량 데이터 작성에 동의하고 실행 (미지정 시 실행 거부)

옵션:
  -t, --target <url>          대상 LabHub 베이스 URL (기본값: http://127.0.0.1:18080)
  --setup-token <token>       최초 관리자 셋업 토큰 (기본값: $SETUP_TOKEN 또는 test_setup_token)
  -n, --notes <count>         시딩할 노트 수 (기본값: 10000, 스모크 테스트: 200)
  -u, --users <count>         시딩할 사용자 수 (기본값: 5, 최소 2)
  -p, --projects <count>      시딩할 프로젝트 수 (기본값: 3)
  -r, --reagents <count>      시딩할 시약 수 (기본값: 10)
  -a, --attachments <count>   시딩할 첨부파일 수 (기본값: 5)
  -c, --concurrency <count>   시나리오 부하 동시성 (기본값: 5)
  -d, --duration <sec>        각 시나리오별 실행 시간(초) (기본값: 10)
  --seed-only                 데이터 시딩만 수행하고 시나리오 부하는 건너뜀
  --skip-seed                 데이터 시딩을 건너뛰고 기존 데이터 대상으로 시나리오 실행
  --output-json <path>        JSON 결과 리포트 저장 경로 (기본값: loadtest-report.json)
  --output-md <path>          Markdown 결과 리포트 저장 경로 (기본값: loadtest-report.md)
  -v, --verbose               상세 로그 출력
  -h, --help                  도움말 출력
`);
}
