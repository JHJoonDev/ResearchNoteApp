/**
 * @fileoverview 검색 어댑터 공통 적합성 테스트 스위트 (Conformance Suite)
 * Memory 및 Meilisearch 어댑터가 동일한 테스트 스펙을 통과하는지 검증합니다.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndex } from '../src/index.js';
import { startMeiliContainer, isDockerAvailable } from './helpers/meili-container.js';

/**
 * 어댑터별 공통 적합성 테스트 항목들을 정의하는 헬퍼 함수
 * @param {() => { index: import('../src/types.js').SearchIndex, provider: string }} getContext
 */
function registerConformanceTests(getContext) {
  test('1. health() returns status ok', async () => {
    const { index, provider } = getContext();
    const h = await index.health();
    assert.strictEqual(h.status, 'ok');
    assert.strictEqual(h.provider, provider);
  });

  test('2. missing or malformed access throws TypeError', async () => {
    const { index } = getContext();
    await assert.rejects(async () => index.search({}), TypeError);
    await assert.rejects(async () => index.search({ access: null }), TypeError);
    await assert.rejects(async () => index.search({ access: {} }), TypeError);
    await assert.rejects(async () => index.search({ access: { projectIds: 'p1' } }), TypeError);
    await assert.rejects(async () => index.search({ access: { projectIds: ['p1'] } }), TypeError);
    await assert.rejects(async () => index.search({ access: { authorId: 'u1' } }), TypeError);
  });

  test('3. upsert replaces rather than duplicates records', async () => {
    const { index } = getContext();
    await index.clear({ wait: true });

    const r1 = {
      id: 'dup-test-1',
      type: 'note',
      title: '초기 연구노트 제목',
      text: '첫 번째 버전 본문',
      tags: ['v1'],
      projectId: null,
      authorId: 'tester',
      status: 'draft',
      isDeleted: false,
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    await index.upsert([r1], { wait: true });

    let res = await index.search({
      q: '초기',
      access: { all: true },
    });
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.items[0].id, 'dup-test-1');

    // 동일 ID로 내용 갱신
    const r2 = {
      ...r1,
      title: '수정 완료된 연구노트 제목',
      text: '두 번째 업데이트 본문',
      tags: ['v2'],
    };

    await index.upsert([r2], { wait: true });

    res = await index.search({
      q: '수정',
      access: { all: true },
    });
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.items[0].id, 'dup-test-1');

    // 전체 레코드 수도 여전히 1개여야 함
    const allRes = await index.search({ access: { all: true } });
    assert.strictEqual(allRes.total, 1);
  });

  test('4. access matrix: total, items and snippets do not leak unauthorized records', async () => {
    const { index } = getContext();
    await index.clear({ wait: true });

    const records = [
      {
        id: 'note-proj-1',
        type: 'note',
        title: '프로젝트 1 합성 실험 보고서',
        text: '프로젝트 1 팀원만 열람 가능한 비밀 실험 데이터 및 결과',
        tags: ['proj1'],
        projectId: 'p1',
        authorId: 'userA',
        status: 'approved',
        isDeleted: false,
        updatedAt: '2026-11-02T10:00:00.000Z',
      },
      {
        id: 'note-proj-2',
        type: 'note',
        title: '프로젝트 2 임상 실험 보고서',
        text: '프로젝트 2 팀원 전용 극비 데이터 및 결과',
        tags: ['proj2'],
        projectId: 'p2',
        authorId: 'userB',
        status: 'approved',
        isDeleted: false,
        updatedAt: '2026-11-03T10:00:00.000Z',
      },
      {
        id: 'note-private-A',
        type: 'note',
        title: 'UserA 개인 연구 메모',
        text: 'UserA 본인만 볼 수 있는 비공개 개인 실험 결과 메모',
        tags: ['private'],
        projectId: null,
        authorId: 'userA',
        status: 'draft',
        isDeleted: false,
        updatedAt: '2026-11-04T10:00:00.000Z',
      },
      {
        id: 'note-private-B',
        type: 'note',
        title: 'UserB 개인 비밀 노트',
        text: 'UserB 본인 전용 비밀 노트 내용',
        tags: ['private'],
        projectId: null,
        authorId: 'userB',
        status: 'draft',
        isDeleted: false,
        updatedAt: '2026-11-05T10:00:00.000Z',
      },
    ];

    await index.upsert(records, { wait: true });

    // UserA는 프로젝트 p1 참여자이며 개인 노트 작성자임
    const userAAccess = { projectIds: ['p1'], authorId: 'userA' };

    // UserA가 '결과'로 검색: note-proj-1과 note-private-A만 보여야 함 (note-proj-2 절대 누출 금지)
    const resA = await index.search({
      q: '결과',
      access: userAAccess,
    });

    assert.strictEqual(resA.total, 2, 'UserA의 접근 권한 내 일치 건수는 2건이어야 함');
    assert.strictEqual(resA.items.length, 2);
    const returnedIdsA = resA.items.map((i) => i.id);
    assert.ok(returnedIdsA.includes('note-proj-1'));
    assert.ok(returnedIdsA.includes('note-private-A'));
    assert.ok(!returnedIdsA.includes('note-proj-2'), '비참여 프로젝트 p2 노출 차단');
    assert.ok(!returnedIdsA.includes('note-private-B'), '타인의 개인 노트 노출 차단');

    // 스니펫에 타인의 기밀 텍스트가 절대 포함되지 않아야 함
    for (const item of resA.items) {
      assert.ok(!item.snippet.includes('프로젝트 2 팀원 전용'));
      assert.ok(!item.snippet.includes('UserB'));
    }

    // 관리자는 전체 열람 가능
    const adminRes = await index.search({
      q: '결과',
      access: { all: true },
    });
    assert.strictEqual(adminRes.total, 3, '관리자는 전체 3건의 결과 검색');
  });

  test('5. deleted records are hidden unless includeDeleted is true', async () => {
    const { index } = getContext();
    await index.clear({ wait: true });

    const records = [
      {
        id: 'active-note',
        type: 'note',
        title: '유효한 활성 연구노트',
        text: '정상 연구 데이터',
        tags: ['active'],
        projectId: null,
        authorId: 'u1',
        status: 'draft',
        isDeleted: false,
        updatedAt: '2026-11-06T00:00:00.000Z',
      },
      {
        id: 'deleted-note',
        type: 'note',
        title: '삭제된 연구노트',
        text: '소프트 삭제된 데이터',
        tags: ['deleted'],
        projectId: null,
        authorId: 'u1',
        status: 'draft',
        isDeleted: true,
        updatedAt: '2026-11-06T00:00:00.000Z',
      },
    ];

    await index.upsert(records, { wait: true });

    // 기본 검색 (includeDeleted 미지정): 삭제된 문서는 제외
    const normalRes = await index.search({
      access: { all: true },
    });
    assert.strictEqual(normalRes.total, 1);
    assert.strictEqual(normalRes.items[0].id, 'active-note');

    // includeDeleted: true 인 경우 삭제된 문서 포함
    const includeDeletedRes = await index.search({
      access: { all: true },
      filters: { includeDeleted: true },
    });
    assert.strictEqual(includeDeletedRes.total, 2);
  });

  test('6. Korean partial match: 완충 finds 완충용액', async () => {
    const { index } = getContext();
    await index.clear({ wait: true });

    const records = [
      {
        id: 'korean-note-1',
        type: 'note',
        title: '인산염 완충용액 제조 프로토콜',
        text: 'PBS 완충용액을 pH 7.4로 맞추어 세포 배양에 사용한다.',
        tags: ['시약', '완충액'],
        projectId: null,
        authorId: 'u1',
        status: 'draft',
        isDeleted: false,
        updatedAt: '2026-11-07T00:00:00.000Z',
      },
      {
        id: 'korean-note-2',
        type: 'note',
        title: '세포 배양 배지 준비',
        text: 'DMEM 배지에 FBS를 첨가하여 혼합한다.',
        tags: ['배지'],
        projectId: null,
        authorId: 'u1',
        status: 'draft',
        isDeleted: false,
        updatedAt: '2026-11-07T00:00:00.000Z',
      },
    ];

    await index.upsert(records, { wait: true });

    // '완충' 검색 시 '완충용액'이 포함된 korean-note-1이 검색되어야 함
    const res = await index.search({
      q: '완충',
      access: { all: true },
    });

    assert.strictEqual(res.total, 1, '부분 일치 검색으로 1건 매칭');
    assert.strictEqual(res.items[0].id, 'korean-note-1');
    assert.ok(res.items[0].snippet.includes('완충') || res.items[0].snippet.includes('mark'));
  });

  test('7. paging stability: items sliced correctly without duplication', async () => {
    const { index } = getContext();
    await index.clear({ wait: true });

    const records = [];
    for (let i = 1; i <= 15; i++) {
      records.push({
        id: `page-item-${String(i).padStart(2, '0')}`,
        type: 'note',
        title: `연속 실험 노트 ${i}`,
        text: `동일한 배치 실험 데이터 번호 ${i}`,
        tags: ['batch'],
        projectId: 'p_batch',
        authorId: 'u1',
        status: 'draft',
        isDeleted: false,
        updatedAt: new Date(1700000000000 + i * 1000).toISOString(),
      });
    }

    await index.upsert(records, { wait: true });

    const access = { projectIds: ['p_batch'], authorId: 'u1' };

    const page1 = await index.search({ q: '실험', access, page: 1, limit: 5 });
    const page2 = await index.search({ q: '실험', access, page: 2, limit: 5 });
    const page3 = await index.search({ q: '실험', access, page: 3, limit: 5 });
    const page4 = await index.search({ q: '실험', access, page: 4, limit: 5 });

    assert.strictEqual(page1.total, 15);
    assert.strictEqual(page1.items.length, 5);
    assert.strictEqual(page2.items.length, 5);
    assert.strictEqual(page3.items.length, 5);
    assert.strictEqual(page4.items.length, 0);

    // 페이지 간 중복 ID가 없어야 함
    const allSeenIds = [
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
      ...page3.items.map((i) => i.id),
    ];
    assert.strictEqual(new Set(allSeenIds).size, 15, '15개 모든 항목이 중복 없이 페이징됨');
  });

  test('8. filter injection strings do not compromise access boundary', async () => {
    const { index } = getContext();
    await index.clear({ wait: true });

    const records = [
      {
        id: 'secret-target',
        type: 'note',
        title: '비인가 최고 기밀 프로젝트 데이터',
        text: '허용되지 않은 사용자에게 절대 누출되어서는 안 되는 비밀',
        tags: ['topsecret'],
        projectId: 'classified_proj',
        authorId: 'admin_user',
        status: 'confidential',
        isDeleted: false,
        updatedAt: '2026-11-08T00:00:00.000Z',
      },
    ];

    await index.upsert(records, { wait: true });

    // 악의적인 SQL/Meili 필터 인젝션 페이로드
    const maliciousAccess = {
      projectIds: [
        '" OR 1=1 --',
        'classified_proj" OR "1"="1',
        '") OR (projectId IS NOT NULL OR ("',
        '\' OR \'1\'=\'1',
      ],
      authorId: '" OR "1"="1',
    };

    const res = await index.search({
      q: '" OR authorId = "admin_user" OR "',
      access: maliciousAccess,
      filters: {
        tags: ['" OR 1=1 OR tags = "topsecret'],
      },
    });

    assert.strictEqual(res.total, 0, '필터 인젝션 시도가 차단되어 비인가 기밀이 조회되지 않아야 함');
    assert.strictEqual(res.items.length, 0);
  });

  test('9. remove() and clear() delete items correctly', async () => {
    const { index } = getContext();
    await index.clear({ wait: true });

    await index.upsert(
      [
        {
          id: 'rm-1',
          type: 'note',
          title: '삭제 대상 1',
          text: '내용 1',
          tags: [],
          projectId: null,
          authorId: 'u1',
          status: 'draft',
          isDeleted: false,
          updatedAt: '2026-11-08T00:00:00.000Z',
        },
        {
          id: 'rm-2',
          type: 'note',
          title: '삭제 대상 2',
          text: '내용 2',
          tags: [],
          projectId: null,
          authorId: 'u1',
          status: 'draft',
          isDeleted: false,
          updatedAt: '2026-11-08T00:00:00.000Z',
        },
      ],
      { wait: true }
    );

    let res = await index.search({ access: { all: true } });
    assert.strictEqual(res.total, 2);

    await index.remove(['rm-1'], { wait: true });
    res = await index.search({ access: { all: true } });
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.items[0].id, 'rm-2');

    await index.clear({ wait: true });
    res = await index.search({ access: { all: true } });
    assert.strictEqual(res.total, 0);
  });
}

// 1. Memory 어댑터 적합성 테스트
describe('Conformance Suite [memory]', () => {
  let memoryIndex;

  before(async () => {
    memoryIndex = createSearchIndex({ provider: 'memory' });
    await memoryIndex.ensureSetup();
  });

  after(async () => {
    if (memoryIndex) await memoryIndex.clear();
  });

  registerConformanceTests(() => ({ index: memoryIndex, provider: 'memory' }));
});

// 2. Meilisearch 어댑터 적합성 테스트 (Docker 가용 시 일회용 컨테이너 연동)
const dockerAvailable = isDockerAvailable();

describe('Conformance Suite [meilisearch]', { skip: !dockerAvailable ? 'Docker 데몬을 사용할 수 없어 Meilisearch 테스트 건너뜀' : false }, () => {
  let meiliContainer = null;
  let meiliIndex = null;

  before(async () => {
    if (!dockerAvailable) return;
    meiliContainer = await startMeiliContainer();
    if (meiliContainer) {
      meiliIndex = createSearchIndex({
        provider: 'meilisearch',
        host: meiliContainer.host,
        apiKey: meiliContainer.apiKey,
        indexUid: 'conformance_test_index',
      });
      await meiliIndex.ensureSetup();
    }
  });

  after(async () => {
    if (meiliIndex) {
      await meiliIndex.clear({ wait: true }).catch(() => {});
    }
    if (meiliContainer) {
      await meiliContainer.stop();
    }
  });

  registerConformanceTests(() => ({ index: meiliIndex, provider: 'meilisearch' }));
});
