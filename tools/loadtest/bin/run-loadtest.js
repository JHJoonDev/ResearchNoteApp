#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseConfig } from '../src/config.js';
import { HttpClient } from '../src/client.js';
import { seedData } from '../src/seeder.js';
import { ScenarioRunner } from '../src/scenarios.js';
import { generateReports } from '../src/metrics.js';

async function main() {
  let options;
  try {
    options = parseConfig(process.argv.slice(2));
  } catch (err) {
    console.error(`\n❌ 설정 오류: ${err.message}\n`);
    process.exit(1);
  }

  console.log('================================================================');
  console.log(' 🚀 LabHub HTTP API 부하 및 신뢰성 테스트 (@labhub/loadtest)');
  console.log('================================================================');
  console.log(`- 대상 서버: ${options.target}`);
  console.log(`- 노트 시딩 목표: ${options.notes}건`);
  console.log(`- 동시성: ${options.concurrency} | 시나리오별 시간: ${options.durationSec}초`);
  console.log('================================================================\n');

  // 1. 대상 서버 헬스체크
  const healthClient = new HttpClient(options.target);
  console.log(`[Health] 서버 헬스체크 확인 중 (${options.target}/api/health)...`);
  const healthRes = await healthClient.get('/api/health');
  if (healthRes.ok) {
    console.log('✅ 서버 헬스체크 정상 (status: 200 ok)\n');
  } else {
    console.error(`❌ 서버 헬스체크 실패: HTTP ${healthRes.status} (${JSON.stringify(healthRes.data)})`);
    console.error('스택이 정상 기동 중인지 확인해주세요.');
    process.exit(1);
  }

  // 2. 데이터 시딩
  let context;
  if (!options.skipSeed) {
    try {
      context = await seedData(options);
    } catch (err) {
      console.error(`❌ 시딩 중 오류 발생: ${err.message}`);
      if (err.stack && options.verbose) console.error(err.stack);
      process.exit(1);
    }
  } else {
    console.log('[Seeder] --skip-seed 플래그 지정으로 데이터 시딩을 건너뜁니다.');
    // 최소 컨텍스트 구성
    context = {
      adminClient: new HttpClient(options.target),
      users: [],
      projects: [],
      reagents: [],
      notes: [],
      sealedNotes: [],
      seedSummary: null,
    };
  }

  if (options.seedOnly) {
    console.log('\n[Seeder] --seed-only 완료. 시나리오 실행을 종료합니다.');
    process.exit(0);
  }

  // 3. 9대 시나리오 실행
  console.log('\n================================================================');
  console.log(' 📊 9대 핵심 시나리오 부하 측정 시작');
  console.log('================================================================');

  const runner = new ScenarioRunner(context, options);
  const scenarioResults = await runner.runAll();

  // 4. 결과 집계 및 리포트 작성
  console.log('\n================================================================');
  console.log(' 📝 결과 집계 및 리포트 파일 생성');
  console.log('================================================================');

  const { json, markdown } = generateReports(scenarioResults, {
    ...options,
    seedSummary: context.seedSummary,
  });

  const jsonPath = path.resolve(options.outputJson);
  const mdPath = path.resolve(options.outputMd);

  await writeFile(jsonPath, JSON.stringify(json, null, 2), 'utf8');
  await writeFile(mdPath, markdown, 'utf8');

  console.log(`\n✅ JSON 리포트 저장 완료: ${jsonPath}`);
  console.log(`✅ Markdown 리포트 저장 완료: ${mdPath}\n`);

  console.log(markdown);
}

main().catch((err) => {
  console.error('치명적 실행 오류:', err);
  process.exit(1);
});
