import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, validateConfig } from '../src/config.js';
import { ScenarioMetrics, generateReports } from '../src/metrics.js';
import { HttpClient } from '../src/client.js';

describe('LoadTest Configuration & Safety Guards', () => {
  it('throws when --i-know-this-writes-data flag is missing', () => {
    assert.throws(
      () => parseConfig(['--target', 'http://127.0.0.1:18080']),
      /안전 가드 발동: 대량 데이터 작성을 방지하기 위해/
    );
  });

  it('throws when target host is not localhost or 127.0.0.1', () => {
    assert.throws(
      () =>
        parseConfig([
          '--i-know-this-writes-data',
          '--target',
          'https://production-eln.lab.ac.kr',
        ]),
      /안전 가드 발동: 부하 테스트 대상은 오직 로컬 환경/
    );
  });

  it('accepts localhost and 127.0.0.1 with --i-know-this-writes-data', () => {
    const cfg1 = parseConfig([
      '--i-know-this-writes-data',
      '--target',
      'http://127.0.0.1:18080',
      '--notes',
      '500',
    ]);
    assert.equal(cfg1.target, 'http://127.0.0.1:18080');
    assert.equal(cfg1.notes, 500);

    const cfg2 = parseConfig([
      '--i-know-this-writes-data',
      '--target',
      'http://localhost:5000',
    ]);
    assert.equal(cfg2.target, 'http://localhost:5000');
  });
});

describe('ScenarioMetrics & Report Generation', () => {
  it('calculates throughput, percentiles and success counts accurately', () => {
    const metrics = new ScenarioMetrics('test-scenario');
    metrics.start();

    // 10, 20, 30, ..., 100 ms 레이턴시 데이터 주입
    for (let i = 1; i <= 10; i++) {
      metrics.record(i * 10, 200);
    }
    // 실패 1건 추가
    metrics.record(50, 500, 'Internal Server Error');

    metrics.stop();
    const stats = metrics.compute();

    assert.equal(stats.totalRequests, 11);
    assert.equal(stats.successCount, 10);
    assert.equal(stats.failedCount, 1);
    assert.equal(stats.statusCodes['200'], 10);
    assert.equal(stats.statusCodes['500'], 1);
    assert.equal(stats.rateLimitDistorted, false);
    assert.ok(stats.latency.p50 >= 40 && stats.latency.p50 <= 70);
  });

  it('detects rateLimitDistorted when HTTP 429 occurs', () => {
    const metrics = new ScenarioMetrics('login-rate-limited');
    metrics.start();
    metrics.record(5, 200);
    metrics.record(2, 429, 'Too many requests');
    metrics.stop();

    const stats = metrics.compute();
    assert.equal(stats.rateLimitCount, 1);
    assert.equal(stats.rateLimitDistorted, true);

    const { markdown } = generateReports([metrics], {
      target: 'http://127.0.0.1:18080',
      concurrency: 5,
      durationSec: 5,
    });

    assert.ok(markdown.includes('HTTP 429 감지'));
    assert.ok(markdown.includes('레이트 리밋에 의해 처리량 왜곡됨'));
  });
});

describe('HttpClient Cookie and Header Management', () => {
  it('stores and sends cookies across requests', () => {
    const client = new HttpClient('http://127.0.0.1:18080');
    client.setCookie('labhub_session', 'mock_jwt_token');

    assert.equal(client.getCookieHeader(), 'labhub_session=mock_jwt_token');
    assert.equal(client.defaultHeaders['X-LabHub-Request'], '1');
  });
});
