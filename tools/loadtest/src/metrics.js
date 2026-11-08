/**
 * 시나리오별 응답 레이턴시 및 에러 메트릭 수집기
 */
export class ScenarioMetrics {
  constructor(name) {
    this.name = name;
    this.latencies = [];
    this.statusCodes = new Map();
    this.startTime = 0;
    this.endTime = 0;
    this.errors = [];
  }

  start() {
    this.startTime = performance.now();
  }

  stop() {
    this.endTime = performance.now();
  }

  /**
   * 단일 측정 결과 기록
   * @param {number} durationMs
   * @param {number} status
   * @param {string} [errMsg]
   */
  record(durationMs, status, errMsg) {
    this.latencies.push(durationMs);
    const count = this.statusCodes.get(status) || 0;
    this.statusCodes.set(status, count + 1);
    if (errMsg) {
      if (this.errors.length < 50) this.errors.push(errMsg);
    }
  }

  /**
   * 통계치 산출
   */
  compute() {
    const totalRequests = this.latencies.length;
    const elapsedSec = (this.endTime - this.startTime) / 1000 || 1;
    const throughput = totalRequests / elapsedSec;

    // 성공 판정: 2xx 또는 3xx
    let successCount = 0;
    let rateLimitCount = 0;

    for (const [code, count] of this.statusCodes.entries()) {
      if (code >= 200 && code < 400) {
        successCount += count;
      }
      if (code === 429) {
        rateLimitCount += count;
      }
    }

    const failedCount = totalRequests - successCount;
    const errorRate = totalRequests > 0 ? (failedCount / totalRequests) * 100 : 0;

    // 백분위수 정렬
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p = (pct) => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
      return sorted[idx];
    };

    return {
      scenario: this.name,
      totalRequests,
      successCount,
      failedCount,
      rateLimitCount,
      rateLimitDistorted: rateLimitCount > 0,
      elapsedSec: Math.round(elapsedSec * 100) / 100,
      throughputRps: Math.round(throughput * 10) / 10,
      errorRatePct: Math.round(errorRate * 100) / 100,
      latency: {
        min: sorted.length ? Math.round(sorted[0] * 100) / 100 : 0,
        p50: Math.round(p(50) * 100) / 100,
        p90: Math.round(p(90) * 100) / 100,
        p95: Math.round(p(95) * 100) / 100,
        p99: Math.round(p(99) * 100) / 100,
        max: sorted.length ? Math.round(sorted[sorted.length - 1] * 100) / 100 : 0,
      },
      statusCodes: Object.fromEntries(this.statusCodes.entries()),
      sampleErrors: this.errors.slice(0, 5),
    };
  }
}

/**
 * 전 시나리오 종합 리포트 생성
 */
export function generateReports(results, options = {}) {
  const jsonReport = {
    timestamp: new Date().toISOString(),
    target: options.target,
    seeded: options.seedSummary || null,
    scenarios: results.map((r) => r.compute()),
  };

  const mdLines = [];
  mdLines.push('# LabHub 부하 테스트 실행 결과 리포트 (Load Test Report)');
  mdLines.push('');
  mdLines.push(`- **실행 일시**: ${jsonReport.timestamp}`);
  mdLines.push(`- **대상 호스트**: \`${options.target}\``);
  if (options.seedSummary) {
    mdLines.push(
      `- **시딩 규모**: 사용자 ${options.seedSummary.users}명, 프로젝트 ${options.seedSummary.projects}개, 노트 ${options.seedSummary.notes}건, 시약 ${options.seedSummary.reagents}종, 첨부 ${options.seedSummary.attachments}건`
    );
  }
  mdLines.push(`- **시나리오별 동시성 / 시간**: 동시 ${options.concurrency}명 / ${options.durationSec}초`);
  mdLines.push('');
  mdLines.push('---');
  mdLines.push('');
  mdLines.push('## 1. 시나리오별 성능 및 신뢰성 측정 결과');
  mdLines.push('');
  mdLines.push(
    '| 시나리오 | 처리량 (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | 에러율 (%) | 상태 코드 분포 | 비고/레이트리밋 |'
  );
  mdLines.push(
    '|---|---|---|---|---|---|---|---|'
  );

  for (const s of jsonReport.scenarios) {
    const codes = Object.entries(s.statusCodes)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    const note = s.rateLimitDistorted
      ? `⚠️ HTTP 429 감지 (${s.rateLimitCount}건) - 레이트 리밋에 의해 처리량 왜곡됨`
      : s.errorRatePct > 0
        ? `일부 요청 실패 (${s.failedCount}건)`
        : '정상 통과';

    mdLines.push(
      `| **${s.scenario}** | ${s.throughputRps} | ${s.latency.p50} | ${s.latency.p95} | ${s.latency.p99} | ${s.errorRatePct}% | \`${codes || 'none'}\` | ${note} |`
    );
  }

  mdLines.push('');
  mdLines.push('---');
  mdLines.push('');
  mdLines.push('## 2. 레이트 리밋(Rate Limit) 영향 분석');
  mdLines.push('');
  const rateLimitedScenarios = jsonReport.scenarios.filter((s) => s.rateLimitDistorted);
  if (rateLimitedScenarios.length > 0) {
    mdLines.push(
      '> [!WARNING]\n> 다음 시나리오에서 시스템 보호를 위한 레이트 리밋(`express-rate-limit`)이 동작하여 HTTP 429가 발생하였으며, 이에 따라 처리량 및 응답 성공률 수치가 인위적으로 제한되었습니다:'
    );
    for (const r of rateLimitedScenarios) {
      mdLines.push(`- **${r.scenario}**: HTTP 429 총 ${r.rateLimitCount}회 발생 (총 요청 ${r.totalRequests}회 중)`);
    }
  } else {
    mdLines.push('모든 시나리오가 레이트 리밋 임계치(HTTP 429)에 걸리지 않고 정상 완료되었습니다.');
  }

  mdLines.push('');
  mdLines.push('---');
  mdLines.push('');
  mdLines.push('## 3. 엔드포인트 규격 일치성 및 계약(Contract) 점검');
  mdLines.push('');
  for (const s of jsonReport.scenarios) {
    if (s.sampleErrors && s.sampleErrors.length > 0) {
      mdLines.push(`### ⚠️ \`${s.scenario}\` 특이사항`);
      for (const err of s.sampleErrors) {
        mdLines.push(`- ${err}`);
      }
    }
  }

  return {
    json: jsonReport,
    markdown: mdLines.join('\n'),
  };
}
