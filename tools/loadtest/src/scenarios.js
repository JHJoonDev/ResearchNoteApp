import { ScenarioMetrics } from './metrics.js';
import { HttpClient } from './client.js';

/**
 * 9종 시나리오 실행기
 */
export class ScenarioRunner {
  constructor(context, options) {
    this.context = context;
    this.options = options;
    this.target = options.target;
  }

  /**
   * 지정된 시간(초) 동안 동시 실행 러너들을 구동하여 시나리오 반복 실행
   */
  async runScenario(name, fn) {
    const metrics = new ScenarioMetrics(name);
    metrics.start();

    const durationMs = this.options.durationSec * 1000;
    const endTime = Date.now() + durationMs;
    const concurrency = this.options.concurrency;

    const runners = [];
    for (let w = 0; w < concurrency; w++) {
      runners.push(
        (async () => {
          let taskIdx = w;
          while (Date.now() < endTime) {
            try {
              await fn(metrics, taskIdx++);
            } catch (err) {
              metrics.record(0, 0, err.message);
            }
          }
        })()
      );
    }

    await Promise.all(runners);
    metrics.stop();
    return metrics;
  }

  // --------------------------------------------------------------------------
  // 1. login 시나리오
  // --------------------------------------------------------------------------
  async scenarioLogin() {
    return this.runScenario('login', async (metrics, idx) => {
      const client = new HttpClient(this.target);
      const user = this.context.users[idx % this.context.users.length];
      const res = await client.post('/api/auth/login', {
        email: user.email,
        password: user.password,
      });

      let errMsg;
      if (!res.ok) {
        if (res.status === 429) {
          errMsg = 'HTTP 429: 로그인 레이트 리밋 임계치 초과';
        } else {
          errMsg = `HTTP ${res.status}: ${JSON.stringify(res.data)}`;
        }
      }
      metrics.record(res.durationMs, res.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 2. paged-note-list 시나리오 (GET /api/eln?page&limit)
  // --------------------------------------------------------------------------
  async scenarioPagedNoteList() {
    return this.runScenario('paged-note-list', async (metrics, idx) => {
      const user = this.context.users[idx % this.context.users.length];
      const page = (idx % 5) + 1;
      const res = await user.client.get(`/api/eln?page=${page}&limit=20&sort=-updatedAt`);

      let errMsg;
      if (!res.ok) {
        errMsg = `HTTP ${res.status}: ${JSON.stringify(res.data)}`;
      }
      metrics.record(res.durationMs, res.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 3. open-note 시나리오 (GET /api/eln/:id)
  // --------------------------------------------------------------------------
  async scenarioOpenNote() {
    const notes = this.context.notes;
    if (!notes || notes.length === 0) {
      throw new Error('open-note 실행을 위한 시딩된 노트가 없습니다.');
    }

    return this.runScenario('open-note', async (metrics, idx) => {
      const note = notes[idx % notes.length];
      const res = await note.authorUser.client.get(`/api/eln/${note.id}`);

      let errMsg;
      if (!res.ok) {
        errMsg = `HTTP ${res.status}: ${JSON.stringify(res.data)}`;
      }
      metrics.record(res.durationMs, res.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 4. save-with-version-check 시나리오 (PUT /api/eln/:id with version check)
  // --------------------------------------------------------------------------
  async scenarioSaveWithVersionCheck() {
    const notes = this.context.notes.slice(0, 50); // 안전한 수량 내에서 반복 갱신
    if (!notes || notes.length === 0) {
      throw new Error('save-with-version-check 실행을 위한 시딩된 노트가 없습니다.');
    }

    return this.runScenario('save-with-version-check', async (metrics, idx) => {
      const note = notes[idx % notes.length];
      // 1. 최신 버전 확인
      const getRes = await note.authorUser.client.get(`/api/eln/${note.id}`);
      if (!getRes.ok) {
        metrics.record(getRes.durationMs, getRes.status, `조회 실패: ${JSON.stringify(getRes.data)}`);
        return;
      }

      const currentVersion = getRes.data.version || 1;
      // 2. 버전 체크와 함께 저장
      const putRes = await note.authorUser.client.put(`/api/eln/${note.id}`, {
        title: `${note.title} (수정-${Date.now().toString().slice(-4)})`,
        version: currentVersion,
        changeReason: '부하 테스트 버전 체크 저장',
        contentDoc: {
          type: 'doc',
          schemaVersion: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `부하 테스트 갱신 내용: 버전 ${currentVersion} -> ${currentVersion + 1}`,
                },
              ],
            },
          ],
        },
      });

      let errMsg;
      if (!putRes.ok) {
        errMsg = `HTTP ${putRes.status}: ${JSON.stringify(putRes.data)}`;
      }
      metrics.record(putRes.durationMs, putRes.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 5. search 시나리오 (GET /api/search?q=...)
  // --------------------------------------------------------------------------
  async scenarioSearch() {
    const queries = ['완충', '세포', '실험', '연구', '부하'];

    return this.runScenario('search', async (metrics, idx) => {
      const user = this.context.users[idx % this.context.users.length];
      const q = queries[idx % queries.length];
      const res = await user.client.get(`/api/search?q=${encodeURIComponent(q)}&page=1&limit=20`);

      let errMsg;
      if (!res.ok) {
        errMsg = `HTTP ${res.status}: ${JSON.stringify(res.data)}`;
      }
      metrics.record(res.durationMs, res.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 6. review-queue 시나리오 (GET /api/eln/review-queue?page&limit)
  // --------------------------------------------------------------------------
  async scenarioReviewQueue() {
    return this.runScenario('review-queue', async (metrics, idx) => {
      const user = this.context.users[idx % this.context.users.length];
      const res = await user.client.get('/api/eln/review-queue?page=1&limit=20');

      let errMsg;
      if (!res.ok) {
        errMsg = `HTTP ${res.status}: review-queue 요청 실패 (${JSON.stringify(res.data)})`;
      }
      metrics.record(res.durationMs, res.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 7. approve-with-signing 시나리오 (생성 -> 서명요청 -> 점검자 승인 및 봉인)
  // --------------------------------------------------------------------------
  async scenarioApproveWithSigning() {
    return this.runScenario('approve-with-signing', async (metrics, idx) => {
      // 작성자는 1번 사용자, 점검자는 0번 사용자 (1번 프로젝트의 manager)
      const author = this.context.users[1 % this.context.users.length];
      const reviewer = this.context.users[0]; // 1번 프로젝트의 manager
      const projectId = this.context.projects[0]?.id;

      // 1. 임시 노트 생성
      const createRes = await author.client.post('/api/eln', {
        title: `승인서명-테스트-${Date.now().toString().slice(-6)}-${idx}`,
        projectId,
        tags: ['서명', '부하'],
        contentDoc: {
          type: 'doc',
          schemaVersion: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '전자서명 및 봉인 성능 검증용 노트 본문.' }],
            },
          ],
        },
      });

      if (!createRes.ok) {
        metrics.record(createRes.durationMs, createRes.status, `노트 생성 실패: ${JSON.stringify(createRes.data)}`);
        return;
      }

      const noteId = createRes.data.id || createRes.data._id;
      const initialVersion = createRes.data.version || 1;

      // 2. 작성자 서명 요청 (버전 전달)
      const reqRes = await author.client.post(`/api/eln/${noteId}/request-approval`, {
        version: initialVersion,
        password: author.password,
      });

      if (!reqRes.ok) {
        metrics.record(reqRes.durationMs, reqRes.status, `서명 요청 실패: ${JSON.stringify(reqRes.data)}`);
        return;
      }

      const pendingVersion = reqRes.data?.version || (initialVersion + 1);

      // 3. 점검자 승인 및 전자서명 봉인 (버전 전달)
      const approveRes = await reviewer.client.post(`/api/eln/${noteId}/approve`, {
        version: pendingVersion,
        password: reviewer.password,
        comment: '부하 테스트 서명 승인 완료',
      });

      let errMsg;
      if (!approveRes.ok) {
        errMsg = `점검자 승인 실패 HTTP ${approveRes.status}: ${JSON.stringify(approveRes.data)}`;
      } else if (approveRes.data?.seal?.verifyId) {
        this.context.sealedNotes.push({
          id: noteId,
          verifyId: approveRes.data.seal.verifyId,
        });
      }
      // 측정 대상: 점검자 서명 및 봉인 처리 시간
      metrics.record(approveRes.durationMs, approveRes.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 8. audit-page 시나리오 (GET /api/audit?page&limit)
  // --------------------------------------------------------------------------
  async scenarioAuditPage() {
    return this.runScenario('audit-page', async (metrics, idx) => {
      const page = (idx % 3) + 1;
      const res = await this.context.adminClient.get(`/api/audit?page=${page}&limit=20`);

      let errMsg;
      if (!res.ok) {
        errMsg = `HTTP ${res.status}: ${JSON.stringify(res.data)}`;
      }
      metrics.record(res.durationMs, res.status, errMsg);
    });
  }

  // --------------------------------------------------------------------------
  // 9. verify-endpoint 시나리오 (GET /api/public/verify/:verifyId)
  // --------------------------------------------------------------------------
  async scenarioVerifyEndpoint() {
    const sealed = this.context.sealedNotes;
    if (!sealed || sealed.length === 0) {
      throw new Error('verify-endpoint 실행을 위한 봉인된 노트가 없습니다. 시딩 또는 승인 단계에서 봉인이 정상 생성되었는지 확인하세요.');
    }
    const publicClient = new HttpClient(this.target);

    // 15분당 60회 레이트 리밋 이내로 페이싱:
    // 동시 워커가 5개일 때, 각 워커마다 1000ms 딜레이를 주면 전체 약 5 req/s (10초간 약 45~50회 호출되어 60회 미만 유지)
    const paceDelayMs = this.options.paceVerify !== false
      ? Math.max(200, Math.round((this.options.concurrency * 1000) / 5))
      : 0;

    return this.runScenario('verify-endpoint', async (metrics, idx) => {
      const item = sealed[idx % sealed.length];
      const path = `/api/public/verify/${item.verifyId}`;

      if (paceDelayMs > 0) {
        await new Promise((r) => setTimeout(r, paceDelayMs));
      }

      const res = await publicClient.get(path);

      let errMsg;
      if (!res.ok) {
        if (res.status === 429) {
          errMsg = 'HTTP 429: 공개 검증 레이트 리밋 임계치 초과 (15분당 60회)';
        } else {
          errMsg = `HTTP ${res.status}: ${JSON.stringify(res.data)}`;
        }
      }
      metrics.record(res.durationMs, res.status, errMsg);
    });
  }

  /**
   * 시나리오 순차 실행
   */
  async runAll() {
    const allScenarios = [
      { name: 'login', fn: () => this.scenarioLogin() },
      { name: 'paged-note-list', fn: () => this.scenarioPagedNoteList() },
      { name: 'open-note', fn: () => this.scenarioOpenNote() },
      { name: 'save-with-version-check', fn: () => this.scenarioSaveWithVersionCheck() },
      { name: 'search', fn: () => this.scenarioSearch() },
      { name: 'review-queue', fn: () => this.scenarioReviewQueue() },
      { name: 'approve-with-signing', fn: () => this.scenarioApproveWithSigning() },
      { name: 'audit-page', fn: () => this.scenarioAuditPage() },
      { name: 'verify-endpoint', fn: () => this.scenarioVerifyEndpoint() },
    ];

    const targetList = this.options.scenarios
      ? allScenarios.filter((s) => this.options.scenarios.includes(s.name))
      : allScenarios;

    const results = [];
    for (let i = 0; i < targetList.length; i++) {
      const s = targetList[i];
      console.log(`\n--- [Scenario ${i + 1}/${targetList.length}] ${s.name} ---`);
      results.push(await s.fn());
    }

    return results;
  }
}
