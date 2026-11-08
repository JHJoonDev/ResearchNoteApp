import { HttpClient } from './client.js';

/**
 * 공개 HTTP API를 통해 대량의 초기 데이터를 시딩
 */
export async function seedData(options) {
  const target = options.target;
  const adminClient = new HttpClient(target);
  const log = options.verbose ? console.log : () => {};

  console.log(`[Seeder] 데이터 시딩 시작 (대상: ${target})...`);

  // 1. 초기 관리자 계정 셋업 또는 로그인
  const setupCheck = await adminClient.get('/api/auth/setup');
  const adminEmail = 'admin@lab.ac.kr';
  const adminPass = 'AdminPass1234!';
  const adminName = '시딩관리자';

  if (setupCheck.ok && setupCheck.data?.required) {
    log('[Seeder] 최초 관리자 계정 생성 중...');
    const setupRes = await adminClient.post(
      '/api/auth/setup',
      { name: adminName, email: adminEmail, password: adminPass },
      { 'X-Setup-Token': options.setupToken }
    );
    if (!setupRes.ok) {
      throw new Error(`관리자 셋업 실패: HTTP ${setupRes.status} (${JSON.stringify(setupRes.data)})`);
    }
  }

  // 관리자 로그인
  log('[Seeder] 관리자 로그인 중...');
  const loginRes = await adminClient.post('/api/auth/login', {
    email: adminEmail,
    password: adminPass,
  });
  if (!loginRes.ok) {
    throw new Error(`관리자 로그인 실패: HTTP ${loginRes.status} (${JSON.stringify(loginRes.data)})`);
  }
  const adminUser = loginRes.data?.user || { id: 'admin-id', name: adminName };

  // 2. 사용자(Members) 시딩
  console.log(`[Seeder] 사용자 ${options.users}명 시딩 중...`);
  const users = [];
  const defaultUserPass = 'UserPass1234!';

  for (let i = 1; i <= options.users; i++) {
    const userEmail = `user${i}@lab.ac.kr`;
    const userName = `연구원${i}`;
    const memberRes = await adminClient.post('/api/members', {
      name: userName,
      email: userEmail,
      password: defaultUserPass,
      role: 'researcher',
    });

    let userId;
    if (memberRes.ok) {
      userId = memberRes.data.id;
    } else {
      // 이미 생성된 경우 목록에서 찾기
      const listRes = await adminClient.get('/api/members');
      const found = (listRes.data || []).find((m) => m.email === userEmail);
      if (found) userId = found.id;
    }

    // 각 사용자별 전용 HttpClient 생성 및 로그인
    const userClient = new HttpClient(target);
    const uLogin = await userClient.post('/api/auth/login', {
      email: userEmail,
      password: defaultUserPass,
    });

    users.push({
      id: userId,
      email: userEmail,
      name: userName,
      password: defaultUserPass,
      client: uLogin.ok ? userClient : adminClient,
      role: 'researcher',
    });
  }

  // 3. 프로젝트 시딩
  console.log(`[Seeder] 프로젝트 ${options.projects}개 시딩 중...`);
  const projects = [];
  for (let i = 1; i <= options.projects; i++) {
    const pName = `과제-부하테스트-${i}`;
    const pRes = await adminClient.post('/api/projects', {
      name: pName,
      description: `부하 테스트용 가상 프로젝트 ${i}`,
    });

    if (pRes.ok) {
      const p = pRes.data;
      // 생성된 프로젝트에 관리자 및 시딩 사용자들을 매니저/에디터로 등록하여 권한 부여
      const memberList = [
        {
          userId: adminUser.id,
          name: adminUser.name,
          role: 'manager',
        },
        ...users.map((u, idx) => ({
          userId: u.id,
          name: u.name,
          role: idx === 0 ? 'manager' : 'editor', // 1번 사용자는 점검자(manager), 나머지는 에디터(editor)
        })),
      ];

      const putRes = await adminClient.put(`/api/projects/${p._id || p.id}`, {
        members: memberList,
      });
      if (!putRes.ok) {
        throw new Error(`프로젝트 멤버 업데이트 실패: HTTP ${putRes.status} (${JSON.stringify(putRes.data)})`);
      }

      projects.push({ id: p._id || p.id, name: pName });
    }
  }

  // 4. 시약(LIMS) 시딩
  console.log(`[Seeder] 시약 ${options.reagents}종 시딩 중...`);
  const reagents = [];
  for (let i = 1; i <= options.reagents; i++) {
    const rRes = await adminClient.post('/api/lims', {
      name: `시약-Buffer-${i}`,
      brand: 'LabChemical',
      stockValue: 500,
      unit: 'mL',
      minimumStock: 10,
    });
    if (rRes.ok) {
      reagents.push({ id: rRes.data.id || rRes.data._id, name: rRes.data.name });
    }
  }

  // 5. 노트(ELN) 대량 시딩 (배치 동시 생성)
  console.log(`[Seeder] 노트 ${options.notes}건 시딩 중 (동시성 10)...`);
  const notes = [];
  const noteBatchSize = 10;
  const projectIds = projects.map((p) => p.id);

  for (let i = 1; i <= options.notes; i += noteBatchSize) {
    const batchPromises = [];
    const limit = Math.min(i + noteBatchSize - 1, options.notes);

    for (let k = i; k <= limit; k++) {
      const authorUser = users[(k - 1) % users.length];
      const assignedProjectId = projectIds[(k - 1) % projectIds.length];

      // note-format 호환 기본 ProseMirror 문서
      const doc = {
        type: 'doc',
        schemaVersion: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `부하 테스트 실험 노트 #${k}: 완충용액 ${k % 10}ml 및 세포배양 분석 수행.`,
              },
            ],
          },
        ],
      };

      const p = authorUser.client.post('/api/eln', {
        title: `연구노트-${k}: 완충용액 세포실험`,
        projectId: assignedProjectId,
        tags: ['부하테스트', '실험', `배치-${Math.floor(k / 100)}`],
        contentDoc: doc,
      }).then((res) => {
        if (res.ok && res.data) {
          notes.push({
            id: res.data.id || res.data._id,
            title: res.data.title,
            version: res.data.version || 1,
            projectId: assignedProjectId,
            authorId: authorUser.id,
            authorUser,
          });
        } else {
          throw new Error(`노트 생성 실패 (#${k}): HTTP ${res.status} (${JSON.stringify(res.data)})`);
        }
      });

      batchPromises.push(p);
    }

    await Promise.all(batchPromises);
    if (notes.length % 500 === 0 || limit === options.notes || notes.length <= 50) {
      console.log(`[Seeder] 노트 ${notes.length}/${options.notes}건 생성 완료...`);
    }
  }

  // 6. 첨부파일 시딩 (일부 노트 대상)
  console.log(`[Seeder] 첨부파일 ${options.attachments}건 시딩 중...`);
  const attachedNotes = notes.slice(0, Math.min(options.attachments, notes.length));
  for (const n of attachedNotes) {
    const boundary = '----LoadTestFormBoundary' + Math.random().toString(36).slice(2);
    const fileContent = `Dummy file content for note ${n.id} timestamp ${Date.now()}`;
    const payload = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="noteId"`,
      '',
      n.id,
      `--${boundary}`,
      `Content-Disposition: form-data; name="version"`,
      '',
      String(n.version),
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="sample-${n.id}.txt"`,
      'Content-Type: text/plain',
      '',
      fileContent,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploadRes = await n.authorUser.client.post(
      '/api/files/upload',
      payload,
      { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    );
    if (uploadRes.ok) {
      n.version += 1;
    }
  }

  // 7. 서명 및 봉인된 노트 생성 (verify-endpoint 시나리오용)
  console.log('[Seeder] 봉인 검증용 승인 노트 생성 중...');
  const sealedNotes = [];
  const reviewer = users[0];
  // 작성자가 점검자(users[0])가 아닌 노트만 후보로 선택
  const candidateNotes = notes.filter((n) => String(n.authorId) !== String(reviewer.id)).slice(0, 5);

  for (const cNote of candidateNotes) {
    // 1) 작성자의 승인 요청
    const reqRes = await cNote.authorUser.client.post(`/api/eln/${cNote.id}/request-approval`, {
      version: cNote.version,
      password: cNote.authorUser.password,
    });

    if (reqRes.ok) {
      const pendingVersion = reqRes.data?.version || (cNote.version + 1);
      // 2) 점검자(0번 사용자)의 승인
      const approveRes = await reviewer.client.post(`/api/eln/${cNote.id}/approve`, {
        version: pendingVersion,
        password: reviewer.password,
        comment: '부하 테스트용 사전 승인 완료',
      });

      if (approveRes.ok && approveRes.data?.seal?.verifyId) {
        sealedNotes.push({
          id: cNote.id,
          verifyId: approveRes.data.seal.verifyId,
        });
      } else if (!approveRes.ok) {
        log(`[Seeder] 승인 실패 HTTP ${approveRes.status}: ${JSON.stringify(approveRes.data)}`);
      }
    } else {
      log(`[Seeder] 승인 요청 실패 HTTP ${reqRes.status}: ${JSON.stringify(reqRes.data)}`);
    }
  }

  console.log(
    `[Seeder] 데이터 시딩 완료! (노트: ${notes.length}건, 봉인노트: ${sealedNotes.length}건, 사용자: ${users.length}명)`
  );

  return {
    adminClient,
    users,
    projects,
    reagents,
    notes,
    sealedNotes,
    seedSummary: {
      users: users.length,
      projects: projects.length,
      notes: notes.length,
      reagents: reagents.length,
      attachments: attachedNotes.length,
      sealed: sealedNotes.length,
    },
  };
}
