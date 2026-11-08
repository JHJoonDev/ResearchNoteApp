import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { seedData } from '../src/seeder.js';
import { ScenarioRunner } from '../src/scenarios.js';
import { generateReports } from '../src/metrics.js';

describe('End-to-End Smoke Test with Contract-Compliant Server', () => {
  let server;
  let baseUrl;
  const mockDb = {
    users: [],
    projects: [],
    reagents: [],
    notes: [],
    seals: [],
    attachments: [],
  };

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let json = {};
        if (body && req.headers['content-type']?.includes('application/json')) {
          try {
            json = JSON.parse(body);
          } catch {}
        }

        res.setHeader('Content-Type', 'application/json');

        // 1. Health
        if (path === '/api/health') {
          return res.writeHead(200).end(JSON.stringify({ status: 'ok' }));
        }

        // 2. Auth setup
        if (path === '/api/auth/setup') {
          if (req.method === 'GET') {
            return res.writeHead(200).end(JSON.stringify({ required: mockDb.users.length === 0 }));
          }
          if (req.method === 'POST') {
            const u = { id: 'admin-1', ...json, role: 'admin' };
            mockDb.users.push(u);
            return res.writeHead(201).end(JSON.stringify({ success: true, user: u }));
          }
        }

        // 3. Auth login
        if (path === '/api/auth/login' && req.method === 'POST') {
          res.setHeader('Set-Cookie', 'labhub_session=mock_session_token; Path=/; HttpOnly');
          return res.writeHead(200).end(JSON.stringify({ success: true, user: { id: 'u-1', email: json.email } }));
        }

        // 4. Members
        if (path === '/api/members') {
          if (req.method === 'GET') {
            return res.writeHead(200).end(JSON.stringify(mockDb.users));
          }
          if (req.method === 'POST') {
            const u = { id: `user-${mockDb.users.length + 1}`, ...json };
            mockDb.users.push(u);
            return res.writeHead(201).end(JSON.stringify(u));
          }
        }

        // 5. Projects
        if (path === '/api/projects') {
          if (req.method === 'POST') {
            const p = { id: `proj-${mockDb.projects.length + 1}`, ...json };
            mockDb.projects.push(p);
            return res.writeHead(201).end(JSON.stringify(p));
          }
        }
        if (path.startsWith('/api/projects/') && req.method === 'PUT') {
          return res.writeHead(200).end(JSON.stringify({ ok: true }));
        }

        // 6. LIMS Reagents
        if (path === '/api/lims' && req.method === 'POST') {
          const r = { id: `reagent-${mockDb.reagents.length + 1}`, ...json };
          mockDb.reagents.push(r);
          return res.writeHead(201).end(JSON.stringify(r));
        }

        // 7. ELN Notes
        if (path === '/api/eln') {
          if (req.method === 'GET') {
            const page = parseInt(url.searchParams.get('page') || '1', 10);
            const limit = parseInt(url.searchParams.get('limit') || '20', 10);
            return res.writeHead(200).end(
              JSON.stringify({
                items: mockDb.notes.slice((page - 1) * limit, page * limit),
                total: mockDb.notes.length,
                page,
                limit,
              })
            );
          }
          if (req.method === 'POST') {
            const n = { id: `note-${mockDb.notes.length + 1}`, version: 1, ...json };
            mockDb.notes.push(n);
            return res.writeHead(201).end(JSON.stringify(n));
          }
        }

        // ELN review queue
        if (path === '/api/eln/review-queue') {
          return res.writeHead(200).end(
            JSON.stringify({
              items: mockDb.notes.filter((n) => n.status === '승인대기'),
              total: 0,
              page: 1,
              limit: 20,
            })
          );
        }

        // Specific note
        const noteMatch = path.match(/^\/api\/eln\/([^/]+)$/);
        if (noteMatch) {
          const id = noteMatch[1];
          const n = mockDb.notes.find((x) => x.id === id) || { id, title: 'Mock Note', version: 1 };
          if (req.method === 'GET') {
            return res.writeHead(200).end(JSON.stringify(n));
          }
          if (req.method === 'PUT') {
            n.version = (n.version || 1) + 1;
            n.title = json.title || n.title;
            return res.writeHead(200).end(JSON.stringify(n));
          }
        }

        // Request approval
        if (path.endsWith('/request-approval')) {
          return res.writeHead(200).end(JSON.stringify({ success: true, status: '승인대기' }));
        }

        // Approve
        if (path.endsWith('/approve')) {
          const verifyId = 'mock-verify-id-12345';
          mockDb.seals.push({ verifyId });
          return res.writeHead(200).end(
            JSON.stringify({
              success: true,
              status: '승인됨',
              seal: { verifyId, sealHash: 'mock-seal-hash' },
            })
          );
        }

        // Files upload
        if (path === '/api/files/upload') {
          return res.writeHead(201).end(JSON.stringify({ id: 'file-1', filename: 'sample.txt' }));
        }

        // Search
        if (path === '/api/search') {
          return res.writeHead(200).end(
            JSON.stringify({
              items: [{ id: 'note-1', title: '연구노트-1', snippet: '완충용액 테스트', score: 10 }],
              total: 1,
              page: 1,
              limit: 20,
            })
          );
        }

        // Audit
        if (path === '/api/audit') {
          return res.writeHead(200).end(
            JSON.stringify({
              items: [{ id: 'audit-1', action: 'CREATE', targetType: 'ELN' }],
              total: 1,
              page: 1,
              limit: 20,
            })
          );
        }

        // Verify public
        if (path.startsWith('/api/public/verify/')) {
          return res.writeHead(200).end(JSON.stringify({ valid: true, algorithm: 'Ed25519' }));
        }

        res.writeHead(404).end(JSON.stringify({ message: 'Not found' }));
      });
    });

    await new Promise((resolve) => server.listen(18090, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:18090';
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('runs complete 200-note seeding and 9-scenario load test suite successfully', async () => {
    const options = {
      target: baseUrl,
      setupToken: 'test_setup_token',
      notes: 50, // 테스트 스위트용 50개
      users: 3,
      projects: 2,
      reagents: 5,
      attachments: 2,
      concurrency: 3,
      durationSec: 1, // 1초씩 빠른 검증
      verbose: false,
    };

    // 1. 시딩
    const context = await seedData(options);
    assert.equal(context.users.length, 3);
    assert.equal(context.projects.length, 2);
    assert.equal(context.notes.length, 50);
    assert.ok(context.sealedNotes.length > 0);

    // 2. 9대 시나리오 실행
    const runner = new ScenarioRunner(context, options);
    const results = await runner.runAll();

    assert.equal(results.length, 9);
    for (const r of results) {
      const stats = r.compute();
      assert.ok(stats.totalRequests > 0, `${stats.scenario} should have executed requests`);
      assert.equal(stats.failedCount, 0, `${stats.scenario} should have 0 failed requests on mock server`);
    }

    // 3. 리포트 생성 검증
    const { json, markdown } = generateReports(results, options);
    assert.equal(json.scenarios.length, 9);
    assert.ok(markdown.includes('LabHub 부하 테스트 실행 결과 리포트'));
    assert.ok(markdown.includes('paged-note-list'));
    assert.ok(markdown.includes('approve-with-signing'));
  });
});
