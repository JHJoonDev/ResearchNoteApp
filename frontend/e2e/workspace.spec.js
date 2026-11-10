import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { test, expect } from '@playwright/test';

const decodeBase32 = (value) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index >= 0) bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8)
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
};
const totp = (secret) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
};
const freshTotp = async (secret) => {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await new Promise((resolve) => setTimeout(resolve, remaining + 100));
  return totp(secret);
};
let adminTotpSecret = '';
let adminRecoveryCodes = [];

async function login(page, email, password, code) {
  await page.goto('/login');
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '연구 공간 열기' }).click();
  if (code) {
    await expect(page.getByRole('heading', { name: '2단계 인증' })).toBeVisible();
    const currentCode = typeof code === 'function' ? await code() : code;
    await page.getByLabel('인증 코드 또는 복구 코드').fill(currentCode);
    await page.getByRole('button', { name: '확인하고 로그인' }).click();
  }
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
}

test('최초 설정 → 프로젝트 → 노트·초안·첨부·검토·모바일', async ({ page }) => {
  const errors = [];
  const aiRequests = [];
  const aiChunkRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/ai/')) aiRequests.push(pathname);
    if (/\/components\/ai\/|\/assets\/Ai/i.test(pathname)) aiChunkRequests.push(pathname);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '연구실 시작하기' })).toBeVisible();
  await page.getByLabel('이름', { exact: true }).fill('테스트 관리자');
  await page.getByLabel('이메일', { exact: true }).fill('browser@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('Browser-passphrase-2026');
  await page.getByRole('button', { name: '관리자 계정 만들기' }).click();
  await expect(page.getByRole('heading', { name: '테스트 관리자님의 연구 공간' })).toBeVisible();
  if (process.env.E2E_FAKE_AI !== '1') {
    await expect.poll(() => aiRequests.filter((path) => path === '/api/ai/status').length).toBe(1);
    await page.getByRole('link', { name: '연구노트', exact: true }).click();
    await page.getByRole('button', { name: '새 노트 작성' }).click();
    await expect(page.getByRole('button', { name: 'AI 초안' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '표 추출' })).toHaveCount(0);
    await page.getByRole('button', { name: '초안 보관하고 닫기' }).click();
    expect(aiChunkRequests).toEqual([]);
    expect(aiRequests.filter((path) => path === '/api/ai/status')).toHaveLength(1);
  }
  await page.getByRole('link', { name: '프로젝트', exact: true }).click();
  await page.getByRole('button', { name: '새 프로젝트' }).click();
  await page.getByLabel('프로젝트 이름').fill('배터리 소재 실험');
  await page.getByLabel('설명', { exact: true }).fill('전극 특성 관찰');
  await page.getByLabel('과제 종료일 (선택)').fill('2026-12-31');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '배터리 소재 실험' })).toBeVisible();
  await expect(page.getByText(/종료일:/)).toBeVisible();
  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByRole('button', { name: '새 노트 작성' }).click();
  await page.getByLabel('제목', { exact: true }).fill('양극재 초기 실험');
  await page
    .getByRole('combobox', { name: '프로젝트', exact: true })
    .selectOption({ label: '배터리 소재 실험' });
  await page.getByRole('combobox', { name: '템플릿', exact: true }).selectOption('basic');
  const noteEditor = page.locator('.workspace-dialog .ProseMirror[contenteditable="true"]');
  await expect(noteEditor).toContainText('실험 목적');
  await noteEditor.fill('샘플 A의 전도도를 3회 측정했다.');
  await page.getByLabel('태그 (쉼표로 구분)').fill('전극,측정');
  await page.getByRole('button', { name: '초안 보관하고 닫기' }).click();
  await page.reload();
  await page.getByRole('button', { name: '초안 복구' }).click();
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('양극재 초기 실험');
  await expect(noteEditor).toContainText('전도도');
  await page.getByRole('button', { name: '서버에 저장' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /양극재 초기 실험/ })).toBeVisible();
  await page.getByLabel('전체 연구노트 검색').fill('전도도');
  await page.getByRole('button', { name: '검색' }).click();
  await expect(page.getByRole('heading', { name: '전체 검색' })).toBeVisible();
  await page.getByRole('link', { name: '양극재 초기 실험' }).click();
  await expect(page.getByRole('dialog', { name: /연구노트 · v1/ })).toBeVisible();
  await page.getByLabel('파일 추가').setInputFiles({
    name: '측정결과.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('conductivity: 42'),
  });
  await expect(page.getByRole('button', { name: /측정결과.txt/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '연구노트 · v2' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 내보내기' }).click();
  await download;
  await page.getByRole('button', { name: '편집', exact: true }).click();
  await noteEditor.fill('전도도 재측정 완료. 평균 42.');
  await page.getByLabel('수정 사유').fill('재측정 결과 보완');
  await page.getByRole('button', { name: '서버에 저장' }).click();
  await page.getByRole('button', { name: /양극재 초기 실험/ }).click();
  await expect(page.getByRole('heading', { name: '연구노트 · v3' })).toBeVisible();
  await page.getByRole('button', { name: '변경 이력' }).click();
  await expect(page.getByRole('dialog', { name: '버전 비교 및 복원' })).toContainText('재측정 결과 보완');
  await page
    .getByRole('dialog', { name: '버전 비교 및 복원' })
    .getByRole('button', { name: '닫기', exact: true })
    .click();
  await page.getByRole('button', { name: '승인 요청', exact: true }).click();
  const authorSign = page.getByRole('dialog', { name: '작성자 서명 및 검토 요청' });
  await authorSign.getByLabel('비밀번호', { exact: true }).fill('Browser-passphrase-2026');
  await authorSign.getByRole('button', { name: '서명하고 요청' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /양극재 초기 실험/ }).click();
  await expect(page.getByText('다른 관리자의 검토를 기다리고 있습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '편집', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '승인 요청 취소' }).click();
  await page.getByRole('button', { name: /양극재 초기 실험/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('dialog').getByRole('button', { name: '휴지통', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '휴지통', exact: true }).click();
  await page.getByRole('button', { name: '복원' }).click();
  await page.getByRole('button', { name: '노트로 돌아가기' }).click();
  await expect(page.getByRole('button', { name: /양극재 초기 실험/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await expect
    .poll(async () => (await page.locator('.top-header .search-bar').boundingBox()).width)
    .toBeGreaterThan(160);
  await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 820, height: 1000 });
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    )
    .toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: '연구실 멤버', exact: true }).click();
  await page.getByRole('button', { name: '멤버 등록' }).click();
  await page.getByLabel('이름', { exact: true }).fill('공동 연구원');
  await page.getByLabel('이메일', { exact: true }).fill('colleague@example.test');
  await page.getByLabel('초기 비밀번호 (12자 이상)').fill('Colleague-passphrase-2026');
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '공동 연구원' })).toBeVisible();
  await page.getByRole('link', { name: '프로젝트', exact: true }).click();
  await page.getByRole('button', { name: '프로젝트 관리' }).click();
  await page.getByLabel('공동 연구원 프로젝트 권한').selectOption('manager');
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();

  await page.getByRole('link', { name: '계정 및 데이터' }).click();
  const mfaCard = page.locator('.mfa-card');
  await mfaCard.getByLabel('현재 비밀번호').fill('Browser-passphrase-2026');
  await mfaCard.getByRole('button', { name: '2단계 인증 등록' }).click();
  await expect(mfaCard.getByRole('img', { name: '인증 앱 등록 QR 코드' })).toBeVisible();
  adminTotpSecret = (await mfaCard.locator('.hash-value').innerText()).trim();
  await mfaCard.getByLabel('인증 앱 코드').fill(totp(adminTotpSecret));
  await mfaCard.getByRole('button', { name: '2단계 인증 켜기' }).click();
  adminRecoveryCodes = (await mfaCard.locator('.recovery-codes pre').innerText()).trim().split(/\s+/);
  expect(adminRecoveryCodes).toHaveLength(10);
  await expect(mfaCard.getByRole('button', { name: '복구 코드 복사' })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await login(page, 'browser@example.test', 'Browser-passphrase-2026', () => freshTotp(adminTotpSecret));
  await expect(page.getByRole('heading', { name: '테스트 관리자님의 연구 공간' })).toBeVisible();

  await page.getByRole('link', { name: '시약 관리', exact: true }).click();
  await page.getByRole('button', { name: '새 시약', exact: true }).click();
  await page.getByLabel('시약명').fill('Ethanol');
  await page.getByLabel('수량', { exact: true }).fill('5');
  await page.getByLabel('최소 재고 알림 기준').fill('1');
  await page.getByRole('button', { name: '시약 등록', exact: true }).click();
  await expect(page.locator('td').filter({ hasText: /^Ethanol$/ })).toBeVisible();
  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByRole('button', { name: '새 노트 작성' }).click();
  await page.getByLabel('제목', { exact: true }).fill('실패해도 남는 초안');
  await page
    .getByRole('combobox', { name: '프로젝트', exact: true })
    .selectOption({ label: '배터리 소재 실험' });
  await page.locator('.workspace-dialog .ProseMirror[contenteditable="true"]').fill('연결 실패 복구 확인\n'.repeat(150) + '문서 끝 확인');
  await page.route('**/api/eln', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '테스트 연결 실패' }),
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: '서버에 저장' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('테스트 연결 실패');
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('실패해도 남는 초안');
  await page.unroute('**/api/eln');
  await page.getByRole('button', { name: '서버에 저장' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /실패해도 남는 초안/ }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: '실패해도 남는 초안' }),
  ).toBeVisible();
  const pdf = await page.pdf({ path: 'test-results/note-print.pdf', format: 'A4' });
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBeGreaterThan(1);

  await page.getByRole('button', { name: '승인 요청', exact: true }).click();
  const mfaSign = page.getByRole('dialog', { name: '작성자 서명 및 검토 요청' });
  await mfaSign.getByLabel('비밀번호', { exact: true }).fill('Browser-passphrase-2026');
  await mfaSign.getByLabel('인증 앱 코드').fill(totp(adminTotpSecret));
  await mfaSign.getByRole('button', { name: '서명하고 요청' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: '로그아웃' }).click();
  await login(page, 'colleague@example.test', 'Colleague-passphrase-2026');
  await expect(page.getByRole('heading', { name: '공동 연구원님의 연구 공간' })).toBeVisible();
  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByRole('button', { name: /실패해도 남는 초안/ }).click();
  await expect(page.getByRole('button', { name: '승인 및 잠금' })).toBeVisible();
  await page.getByRole('button', { name: '승인 및 잠금' }).click();
  const reviewerSign = page.getByRole('dialog', { name: '점검자 서명 및 승인' });
  await reviewerSign.getByLabel('비밀번호', { exact: true }).fill('Colleague-passphrase-2026');
  await reviewerSign.getByLabel('검토 의견 (선택)').fill('기록과 근거를 확인했습니다.');
  await reviewerSign.getByRole('button', { name: '서명하고 승인' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /실패해도 남는 초안/ }).click();
  const sealPanel = page.locator('.seal-panel');
  await expect(sealPanel.getByText('봉인 해시')).toBeVisible();
  await expect(sealPanel.getByRole('button', { name: '봉인 PDF 다운로드' })).toBeVisible();
  const sealedPdf = page.waitForEvent('download');
  await sealPanel.getByRole('button', { name: '봉인 PDF 다운로드' }).click();
  const sealedPdfDownload = await sealedPdf;
  const sealedPdfBuffer = await readFile(await sealedPdfDownload.path());
  const evidenceBundle = page.waitForEvent('download');
  await sealPanel.getByRole('button', { name: '증빙 패키지 다운로드' }).click();
  await evidenceBundle;
  await sealPanel.getByRole('button', { name: '서버 검증 실행' }).click();
  await expect(sealPanel.getByText('서버 검증 통과')).toBeVisible();
  const publicPagePromise = page.context().waitForEvent('page');
  await sealPanel.getByRole('link', { name: '공개 검증 결과' }).click();
  const publicPage = await publicPagePromise;
  await expect(publicPage.getByRole('heading', { name: '봉인 공개 검증' })).toBeVisible();
  await publicPage.getByLabel('PDF 선택').setInputFiles({
    name: 'note.pdf',
    mimeType: 'application/pdf',
    buffer: sealedPdfBuffer,
  });
  await expect(publicPage.getByText('PDF 해시 일치')).toBeVisible();
  await publicPage.close();

  await page.getByRole('dialog', { name: '연구노트 · v3' }).getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await login(page, 'browser@example.test', 'Browser-passphrase-2026', adminRecoveryCodes.shift());
  await expect(page.getByRole('heading', { name: '테스트 관리자님의 연구 공간' })).toBeVisible();
  await page.getByRole('link', { name: '연구실 멤버', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '비활성화' }).click();
  await expect(page.getByText('비활성', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '재활성화' }).click();
  await expect(page.getByRole('button', { name: '비활성화' })).toBeVisible();

  await page.getByRole('link', { name: '감사 로그', exact: true }).click();
  await page.getByRole('button', { name: '감사 체인 검증' }).click();
  await expect(page.getByRole('heading', { name: '감사 체인 검증 결과' })).toBeVisible();

  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByRole('button', { name: /실패해도 남는 초안/ }).click();
  await page.getByRole('button', { name: '정정 (개정판 작성)' }).click();
  const amendDialog = page.getByRole('dialog', { name: '승인 후 정정 개정판 작성' });
  await amendDialog.getByLabel('정정 사유').fill('측정 결과 해석을 보완합니다.');
  await amendDialog.getByRole('button', { name: '개정판 작성' }).click();
  await expect(page.getByText('정정 개정판', { exact: true })).toBeVisible();
  await expect(page.getByText('측정 결과 해석을 보완합니다.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Phase 2: protocol runs, block content, version restore, comments, search and pagination', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  await login(page, 'colleague@example.test', 'Colleague-passphrase-2026');

  await page.getByRole('link', { name: '프로토콜', exact: true }).click();
  await page.getByRole('button', { name: /새 프로토콜/ }).click();
  const protocolDialog = page.getByRole('dialog', { name: '새 프로토콜' });
  await protocolDialog.getByLabel('제목', { exact: true }).fill('E2E 측정 프로토콜');
  await protocolDialog.getByRole('combobox', { name: '프로젝트', exact: true }).selectOption({ label: '배터리 소재 실험' });
  await protocolDialog.getByLabel('단계 제목').fill('전도도 확인');
  await protocolDialog.getByLabel('절차').fill('시료를 세 번 측정합니다.');
  await protocolDialog.getByLabel(/체크 항목/).fill('측정기 보정\n시료 기록');
  await protocolDialog.getByLabel(/결과 필드/).fill('평균 전도도|mS|number');
  await protocolDialog.getByRole('button', { name: '저장', exact: true }).click();
  const protocolCard = page.locator('.protocol-card').filter({ hasText: 'E2E 측정 프로토콜' });
  await expect(protocolCard).toBeVisible();
  await protocolCard.getByRole('button', { name: '발행' }).click();
  await protocolCard.getByRole('button', { name: '버전' }).click();
  await expect(page.getByRole('dialog', { name: '프로토콜 버전' })).toContainText('v1');
  await page.getByRole('dialog', { name: '프로토콜 버전' }).getByRole('button', { name: '닫기' }).click();

  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByLabel('프로젝트 필터').selectOption({ label: '배터리 소재 실험' });
  await page.getByRole('button', { name: '실험 관리' }).click();
  const experimentDialog = page.getByRole('dialog', { name: '프로젝트 실험 관리' });
  await experimentDialog.getByRole('button', { name: /새 실험/ }).click();
  await experimentDialog.getByLabel('실험명').fill('E2E 실험');
  await experimentDialog.getByLabel('설명').fill('프론트엔드 통합 검증');
  await experimentDialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(experimentDialog.getByText('E2E 실험')).toBeVisible();
  await experimentDialog.getByRole('button', { name: '닫기' }).click();

  await page.getByRole('button', { name: '새 노트 작성' }).click();
  const editorDialog = page.getByRole('dialog', { name: '새 연구노트' });
  await editorDialog.getByLabel('제목', { exact: true }).fill('E2E 프로토콜 실행 노트');
  await editorDialog.getByRole('combobox', { name: '프로젝트', exact: true }).selectOption({ label: '배터리 소재 실험' });
  await expect(editorDialog.getByRole('option', { name: 'E2E 실험' })).toBeAttached();
  await editorDialog.getByRole('combobox', { name: '실험', exact: true }).selectOption({ label: 'E2E 실험' });
  await expect(editorDialog.getByRole('option', { name: 'E2E 측정 프로토콜 · v1' })).toBeAttached();
  await editorDialog.getByLabel('프로토콜로 실행 시작').selectOption({ label: 'E2E 측정 프로토콜 · v1' });
  const editor = editorDialog.locator('.ProseMirror[contenteditable="true"]');
  await editor.fill('원본 측정 메모');
  await editor.press('End');
  await editorDialog.getByTitle('할 일 목록').click();
  await page.keyboard.type('측정기 보정 완료');
  await editorDialog.getByTitle('표 삽입').click();
  await expect(editorDialog.locator('table')).toBeVisible();
  await expect(editorDialog.locator('.ProseMirror ul[data-type="taskList"]')).toContainText('측정기 보정 완료');
  await editorDialog.getByRole('button', { name: '서버에 저장' }).click();
  await expect(page.getByRole('button', { name: /E2E 프로토콜 실행 노트/ })).toBeVisible();
  await page.getByRole('button', { name: /E2E 프로토콜 실행 노트/ }).click();
  const noteDialog = page.getByRole('dialog', { name: /연구노트/ });
  await expect(noteDialog.getByRole('heading', { name: '프로토콜 실행', exact: true })).toBeVisible();
  await noteDialog.getByRole('checkbox', { name: '측정기 보정', exact: true }).check();
  await noteDialog.getByRole('spinbutton', { name: '평균 전도도 (mS)', exact: true }).fill('42.5');
  await noteDialog.getByRole('button', { name: '실행 결과 저장' }).click();
  await expect(noteDialog.getByRole('button', { name: '실행 결과 저장' })).toBeVisible();
  const pdf = await page.pdf({ format: 'A4' });
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBeGreaterThan(0);

  await noteDialog.getByRole('button', { name: '편집', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: '연구노트 편집' });
  await editDialog.locator('.ProseMirror[contenteditable="true"]').fill('변경된 측정 메모');
  await editDialog.getByLabel('수정 사유').fill('버전 비교용 변경');
  await editDialog.getByRole('button', { name: '서버에 저장' }).click();
  await expect(editDialog).toBeHidden();
  await page.getByRole('button', { name: /E2E 프로토콜 실행 노트/ }).click();
  const currentNoteDialog = page.getByRole('dialog', { name: /연구노트/ });
  await currentNoteDialog.getByRole('button', { name: '변경 이력' }).click();
  const historyDialog = page.getByRole('dialog', { name: '버전 비교 및 복원' });
  await historyDialog.getByRole('button', { name: /v1/ }).click();
  await expect(historyDialog.locator('.doc-diff')).toContainText('원본');
  await expect(historyDialog.locator('.doc-diff')).toContainText('변경된 측정 메모');
  await historyDialog.getByLabel('복원 사유').fill('E2E 복원 확인');
  await historyDialog.getByRole('button', { name: '이 버전을 새 버전으로 복원' }).click();
  const restoredDialog = page.getByRole('dialog', { name: /연구노트/ });
  await expect(restoredDialog.locator('.note-content-rendered')).toContainText('원본 측정 메모');
  await restoredDialog.getByRole('button', { name: '편집', exact: true }).click();
  const imageEditDialog = page.getByRole('dialog', { name: '연구노트 편집' });
  await imageEditDialog.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'protocol-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
  });
  await expect(imageEditDialog.locator('.ProseMirror img[data-attachment-id]')).toHaveCount(1);
  await imageEditDialog.getByLabel('수정 사유').fill('프로토콜 사진 첨부');
  await imageEditDialog.getByRole('button', { name: '서버에 저장' }).click();
  await page.getByRole('button', { name: /E2E 프로토콜 실행 노트/ }).click();
  await expect(page.getByRole('dialog', { name: /연구노트/ }).locator('.note-content-rendered img')).toHaveAttribute('src', /blob:/);

  const noteId = await page.evaluate(async () => {
    const response = await fetch('/api/eln?page=1&limit=100', { credentials: 'include' });
    const body = await response.json();
    return body.items.find((note) => note.title === 'E2E 프로토콜 실행 노트')?.id;
  });
  expect(noteId).toBeTruthy();
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await login(page, 'browser@example.test', 'Browser-passphrase-2026', adminRecoveryCodes.shift());
  await page.goto(`/eln?noteId=${encodeURIComponent(noteId)}`);
  const adminNoteDialog = page.getByRole('dialog', { name: /연구노트/ });
  await adminNoteDialog.getByRole('textbox', { name: '댓글', exact: true }).fill('프로토콜 결과 확인했습니다.');
  await adminNoteDialog.getByLabel(/알림할 멤버/).selectOption({ label: '@공동 연구원' });
  await adminNoteDialog.getByRole('button', { name: '댓글 등록' }).click();
  await expect(adminNoteDialog.getByText('프로토콜 결과 확인했습니다.')).toBeVisible();
  await adminNoteDialog.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await login(page, 'colleague@example.test', 'Colleague-passphrase-2026');
  await page.getByRole('button', { name: /알림/ }).click();
  await expect(page.getByRole('region', { name: '알림 목록' })).toContainText('댓글에서 회원님을 언급했습니다.');

  await page.getByLabel('전체 연구노트 검색').fill('E2E 프로토콜 실행 노트');
  await page.getByRole('button', { name: '검색' }).click();
  await expect(page.getByRole('heading', { name: '전체 검색' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'E2E 프로토콜 실행 노트' })).toBeVisible();

  await page.goto('/eln');
  const projectId = await page.locator('select[aria-label="프로젝트 필터"] option').filter({ hasText: '배터리 소재 실험' }).getAttribute('value');
  await page.evaluate(async (id) => {
    for (let index = 1; index <= 16; index += 1) {
      const response = await fetch('/api/eln', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-LabHub-Request': '1' },
        body: JSON.stringify({
          title: `E2E 페이지 ${String(index).padStart(2, '0')}`,
          projectId: id,
          contentFormat: 'doc',
          contentDoc: { type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `페이지 fixture ${index}` }] }] },
          tags: [],
        }),
      });
      if (!response.ok) throw new Error(`Pagination fixture failed: ${response.status}`);
    }
  }, projectId);
  await page.goto('/eln');
  await page.getByLabel('프로젝트 필터').selectOption({ label: '배터리 소재 실험' });
  await expect(page.getByRole('navigation', { name: '페이지 이동' })).toContainText('1 /');
  await page.getByRole('navigation', { name: '페이지 이동' }).getByRole('button', { name: '다음' }).click();
  await expect(page.getByRole('navigation', { name: '페이지 이동' })).toContainText('2 /');
});

test('Phase 3: LOT usage, labels, equipment booking, API key and instrument inbox', async ({ page, request }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  await login(page, 'browser@example.test', 'Browser-passphrase-2026', adminRecoveryCodes.shift());

  await page.getByRole('link', { name: '시약 관리', exact: true }).click();
  const reagentId = await page.getByLabel('시약 선택').locator('option').filter({ hasText: 'Ethanol' }).getAttribute('value');
  await page.getByLabel('시약 선택').selectOption(reagentId);
  await page.getByRole('button', { name: '입고 등록', exact: true }).first().click();
  await page.getByLabel('LOT 번호').fill('PH3-E2E-LOT');
  await page.getByLabel('입고 수량').fill('10');
  await page.getByRole('button', { name: '입고 등록', exact: true }).last().click();
  await expect(page.getByRole('status')).toContainText('입고 LOT를 등록했습니다');

  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByRole('button', { name: '새 노트 작성' }).click();
  const noteForm = page.getByRole('dialog', { name: '새 연구노트' });
  const noteTitle = 'Phase 3 LOT usage note';
  await noteForm.getByLabel('제목', { exact: true }).fill(noteTitle);
  await noteForm.locator('.ProseMirror[contenteditable="true"]').fill('LOT별 사용량 검증');
  await noteForm.getByLabel('시약 선택', { exact: true }).selectOption(reagentId);
  const lotSelect = noteForm.getByLabel('시약 LOT 선택');
  await expect(lotSelect.locator('option').filter({ hasText: 'PH3-E2E-LOT' })).toHaveCount(1);
  const lotId = await lotSelect.locator('option').filter({ hasText: 'PH3-E2E-LOT' }).getAttribute('value');
  await lotSelect.selectOption(lotId);
  await noteForm.getByLabel('시약 사용량').fill('2');
  await noteForm.locator('.reagent-selector:not(.entity-usage-selector)').getByRole('button', { name: '추가' }).click();
  await noteForm.getByRole('button', { name: '서버에 저장' }).click();
  await expect(page.getByRole('button', { name: new RegExp(noteTitle) })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(noteTitle) }).click();
  await expect(page.getByRole('dialog', { name: /연구노트/ })).toContainText('PH3-E2E-LOT');
  await page.getByRole('dialog', { name: /연구노트/ }).getByRole('button', { name: '닫기' }).click();

  await page.getByRole('link', { name: '라벨 스캔', exact: true }).click();
  await page.getByLabel('항목 종류').selectOption('reagent');
  await page.locator('select[multiple]').selectOption(reagentId);
  await expect(page.getByRole('heading', { name: 'SVG 미리보기' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ethanol 라벨 미리보기' })).toBeVisible();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF 다운로드' }).click();
  await pdfDownload;
  const zplDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZPL 다운로드' }).click();
  await zplDownload;
  await page.getByLabel('레이블 코드 직접 입력').fill(`LH1:reagent:${reagentId}`);
  await page.locator('.labhub-scanner-manual-form').getByRole('button', { name: '확인' }).click();
  await expect(page.getByRole('link', { name: '항목 열기' })).toBeVisible();

  await page.getByRole('link', { name: '보관 위치', exact: true }).click();
  await page.getByRole('button', { name: '위치 추가' }).click();
  let locationForm = page.locator('.location-detail form');
  await locationForm.getByLabel('이름').fill('Phase 3 E2E Room');
  await locationForm.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: 'Phase 3 E2E Room' })).toBeVisible();
  await page.getByRole('button', { name: '위치 추가' }).click();
  locationForm = page.locator('.location-detail form');
  await locationForm.getByLabel('이름').fill('Phase 3 E2E Box');
  await locationForm.getByLabel('종류').selectOption('box');
  await locationForm.getByLabel('행 수').fill('2');
  await locationForm.getByLabel('열 수').fill('2');
  await locationForm.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('heading', { name: 'Phase 3 E2E Box' })).toBeVisible();
  await expect(page.locator('.location-grid')).toBeVisible();

  await page.getByRole('link', { name: '샘플·장비', exact: true }).click();
  await page.getByRole('tab', { name: '유형 관리' }).click();
  await page.getByRole('button', { name: '유형 추가' }).click();
  const typeForm = page.locator('.phase3-type-form');
  await typeForm.getByLabel('유형 이름').fill('Phase 3 E2E Equipment');
  await typeForm.getByLabel('분류').selectOption('equipment');
  await typeForm.getByLabel('필드 이름').fill('Serial');
  await typeForm.getByRole('button', { name: '유형 저장' }).click();
  await page.getByRole('tab', { name: '개체 목록' }).click();
  await page.getByRole('button', { name: '개체 등록' }).click();
  const entityForm = page.locator('.phase3-page form').last();
  await entityForm.getByLabel('유형').selectOption({ label: 'Phase 3 E2E Equipment' });
  await entityForm.getByLabel('코드').fill('PH3-E2E-EQ');
  await entityForm.getByLabel('이름').fill('Phase 3 E2E Equipment Unit');
  await entityForm.getByLabel('보관 위치').selectOption({ label: 'Phase 3 E2E Box' });
  await entityForm.getByLabel('행').fill('1');
  await entityForm.getByLabel('열').fill('1');
  await entityForm.getByLabel('교정 예정일').fill('2026-11-20');
  await entityForm.getByRole('button', { name: '저장' }).click();
  const equipmentRow = page.locator('.entity-row').filter({ hasText: 'Phase 3 E2E Equipment Unit' });
  await expect(equipmentRow).toBeVisible();
  const equipmentId = await page.evaluate(async () => {
    const response = await fetch('/api/entities?page=1&limit=100', { credentials: 'include' });
    const body = await response.json();
    const entity = body.items.find((item) => item.code === 'PH3-E2E-EQ');
    return entity?.id || entity?._id;
  });
  expect(equipmentId).toBeTruthy();

  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(noteTitle) }).click();
  await page.getByRole('button', { name: '편집', exact: true }).click();
  const noteEdit = page.getByRole('dialog', { name: '연구노트 편집' });
  await noteEdit.getByLabel('사용 개체 선택').selectOption(equipmentId);
  await noteEdit.locator('.entity-usage-selector').getByRole('button', { name: '추가' }).click();
  await noteEdit.getByLabel('수정 사유').fill('장비 사용 기록 추가');
  await noteEdit.getByRole('button', { name: '서버에 저장' }).click();
  await expect(noteEdit).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(noteTitle) }).click();
  await expect(page.getByRole('dialog', { name: /연구노트/ })).toContainText('PH3-E2E-EQ');
  await page.getByRole('dialog', { name: /연구노트/ }).getByRole('button', { name: '닫기', exact: true }).click();

  await page.getByRole('link', { name: '샘플·장비', exact: true }).click();
  await equipmentRow.click();
  const bookingPanel = page.locator('.booking-panel');
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const asLocalInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const firstStart = asLocalInput(start);
  const firstEnd = asLocalInput(new Date(start.getTime() + 60 * 60 * 1000));
  await bookingPanel.getByLabel('시작').fill(firstStart);
  await bookingPanel.getByLabel('종료').fill(firstEnd);
  await bookingPanel.getByLabel('목적').fill('Phase 3 booking');
  await bookingPanel.getByRole('button', { name: '예약 등록' }).click();
  await expect(bookingPanel.locator('.booking-row').filter({ hasText: 'Phase 3 booking' })).toBeVisible();
  await bookingPanel.getByLabel('시작').fill(asLocalInput(new Date(start.getTime() + 30 * 60 * 1000)));
  await bookingPanel.getByLabel('종료').fill(asLocalInput(new Date(start.getTime() + 90 * 60 * 1000)));
  await bookingPanel.getByLabel('목적').fill('Phase 3 overlapping booking');
  await bookingPanel.getByRole('button', { name: '예약 등록' }).click();
  await expect(page.getByRole('alert')).toContainText(/예약|겹|중복|충돌|overlap|conflict/i);

  await page.getByRole('link', { name: 'API 키', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'API 키', level: 1 })).toBeVisible();
  const keyForm = page.locator('.phase3-page form').first();
  await keyForm.getByLabel('이름').fill('Phase 3 Inbox E2E key');
  await keyForm.getByLabel(/기기 수집함 업로드/).check();
  await keyForm.getByRole('button', { name: 'API 키 생성' }).click();
  const apiKey = (await page.locator('.one-time-secret code').innerText()).trim();
  expect(apiKey).toMatch(/^lh_/);
  await expect(page.getByRole('status')).toContainText('한 번만 표시');

  const fileBytes = Buffer.from('phase3 inbox fixture\n');
  const fileSha = createHash('sha256').update(fileBytes).digest('hex');
  const instrumentId = 'phase3-e2e-instrument';
  const relativePath = 'results/phase3-e2e.csv';
  const idempotencyKey = createHash('sha256').update(instrumentId + relativePath + fileSha).digest('hex');
  const capturedAt = new Date().toISOString();
  const uploadResponse = await request.post('http://127.0.0.1:5000/api/v1/inbox/files', {
    headers: { Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': idempotencyKey },
    multipart: {
      file: { name: 'phase3-e2e.csv', mimeType: 'text/csv', buffer: fileBytes },
      instrumentId, relativePath, sha256: fileSha, capturedAt,
    },
  });
  expect(uploadResponse.status()).toBe(201);
  await page.getByRole('link', { name: '기기 수집함', exact: true }).click();
  const inboxRow = page.locator('.inbox-row').filter({ hasText: relativePath });
  await inboxRow.getByLabel('첨부할 연구노트').selectOption({ label: `${noteTitle} · v2` });
  await inboxRow.getByRole('button', { name: '노트에 첨부' }).click();
  await expect(inboxRow.getByText('attached', { exact: true })).toBeVisible();
});

test('Phase 2: password reset consumes a captured mail fragment once', async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.delete('http://127.0.0.1:5099/mail');
  await page.goto('/reset-password');
  await page.getByLabel('이메일', { exact: true }).fill('colleague@example.test');
  await page.getByRole('button', { name: '재설정 링크 요청' }).click();
  await expect(page.getByRole('status')).toContainText('계정이 존재하면');
  await expect.poll(async () => (await (await page.request.get('http://127.0.0.1:5099/mail')).json()).messages.length).toBe(1);
  const mail = (await (await page.request.get('http://127.0.0.1:5099/mail')).json()).messages[0];
  const token = mail.text.match(/\/reset-password#([^\s]+)/)?.[1];
  expect(token).toBeTruthy();
  await page.goto(`/reset-password#${token}`);
  await expect(page.getByRole('heading', { name: '새 비밀번호 설정' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await page.getByLabel('새 비밀번호 (12자 이상)').fill('Colleague-passphrase-2026-reset');
  await page.getByLabel('새 비밀번호 확인').fill('Colleague-passphrase-2026-reset');
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  await expect(page.getByRole('status')).toContainText('비밀번호를 변경했습니다');
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill('colleague@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('Colleague-passphrase-2026-reset');
  await page.getByRole('button', { name: '연구 공간 열기' }).click();
  await expect(page.getByRole('heading', { name: '공동 연구원님의 연구 공간' })).toBeVisible();
});

test('Phase 2: invitation accepts a single-use fragment without auto-login', async ({ page }) => {
  await login(page, 'browser@example.test', 'Browser-passphrase-2026', adminRecoveryCodes.shift());
  await page.request.delete('http://127.0.0.1:5099/mail');
  await page.getByRole('link', { name: '연구실 멤버', exact: true }).click();
  await page.getByRole('button', { name: '멤버 등록' }).click();
  const memberDialog = page.getByRole('dialog', { name: '멤버 등록' });
  await memberDialog.getByLabel('이름', { exact: true }).fill('초대 연구원');
  await memberDialog.getByLabel('이메일', { exact: true }).fill('invitee@example.test');
  await memberDialog.getByLabel('초대 메일 전송').check();
  await memberDialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('초대 요청을 처리했습니다');
  await expect.poll(async () => (await (await page.request.get('http://127.0.0.1:5099/mail')).json()).messages.length).toBe(1);
  const mail = (await (await page.request.get('http://127.0.0.1:5099/mail')).json()).messages[0];
  const token = mail.text.match(/\/invite#([^\s]+)/)?.[1];
  expect(token).toBeTruthy();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.goto(`/invite#${token}`);
  await expect(page.getByText('초대 연구원님, 연구실 초대를 받았습니다.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
  await page.getByLabel('비밀번호 설정 (12자 이상)').fill('Invitee-passphrase-2026');
  await page.getByLabel('비밀번호 확인').fill('Invitee-passphrase-2026');
  await page.getByRole('button', { name: '초대 수락' }).click();
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('초대를 수락했습니다');
  await page.goto(`/invite#${token}`);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.goto('/login');
  await page.getByLabel('이메일', { exact: true }).fill('invitee@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('Invitee-passphrase-2026');
  await page.getByRole('button', { name: '연구 공간 열기' }).click();
  await expect(page.getByRole('heading', { name: '초대 연구원님의 연구 공간' })).toBeVisible();
});

test('Phase 4: fake AI draft, review, protocol and cited answer', async ({ page }) => {
  test.skip(process.env.E2E_FAKE_AI !== '1', 'Fake AI provider is enabled only in this run.');
  test.setTimeout(120_000);
  await login(page, 'invitee@example.test', 'Invitee-passphrase-2026');
  await page.getByRole('link', { name: '연구노트', exact: true }).click();
  await page.getByRole('button', { name: '새 노트 작성' }).click();
  const noteTitle = 'Phase 4 AI provenance note';
  await page.getByLabel('제목', { exact: true }).fill(noteTitle);
  const noteEditor = page.locator('.workspace-dialog .ProseMirror[contenteditable="true"]');
  await noteEditor.fill('초기 실험 관찰 기록');
  await page.getByRole('button', { name: 'AI 초안' }).click();
  const draftDialog = page.getByRole('dialog', { name: 'AI 초안 제안' });
  await draftDialog.getByLabel('실험 메모').fill('온도 25도에서 시료 반응을 관찰했다.');
  await draftDialog.getByRole('button', { name: '초안 만들기' }).click();
  await expect(draftDialog).toContainText('E2E 가짜 AI 초안');
  await expect(draftDialog.getByText('실험 조건')).toBeVisible();
  await draftDialog.getByRole('button', { name: '초안을 문서에 삽입' }).click();
  await expect(noteEditor).toContainText('E2E 가짜 AI 초안');

  await page.getByRole('button', { name: '표 추출' }).click();
  const tableDialog = page.getByRole('dialog', { name: 'AI 표 추출' });
  await tableDialog.getByLabel('표가 포함된 텍스트').fill('이름 | 값\n시료 A | 42');
  await tableDialog.getByRole('button', { name: '표 추출' }).click();
  await expect(tableDialog.getByText('표를 찾지 못했습니다.')).toBeVisible();
  await tableDialog.getByLabel('닫기').click();

  await page.getByRole('button', { name: '서버에 저장' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const savedNote = await page.evaluate(async (title) => {
    const response = await fetch('/api/eln?page=1&limit=100', { credentials: 'include' });
    const body = await response.json();
    const items = Array.isArray(body) ? body : body.items || [];
    const item = items.find((entry) => entry.title === title);
    if (!item) return null;
    const detailResponse = await fetch(`/api/eln/${item.id || item._id}`, { credentials: 'include' });
    return detailResponse.json();
  }, noteTitle);
  expect(savedNote?.aiRuns).toHaveLength(1);
  expect(savedNote.aiRuns[0].feature).toBe('draftNote');
  await page.getByRole('button', { name: new RegExp(noteTitle) }).click();
  await page.getByRole('button', { name: '누락 점검' }).click();
  await expect(page.getByText('점검 결과가 없습니다.')).toBeVisible();
  await page.getByRole('dialog', { name: /연구노트/ }).getByRole('button', { name: '닫기' }).click();

  await page.goto(`/search?q=${encodeURIComponent('E2E 가짜 AI 초안')}`);
  await expect(page.getByRole('heading', { name: '전체 검색' })).toBeVisible();
  await page.getByRole('button', { name: 'AI에게 질문하기' }).click();
  const askDialog = page.getByRole('dialog', { name: '연구노트에 질문하기' });
  await askDialog.getByRole('button', { name: '질문하기' }).click();
  await expect(askDialog).toContainText('E2E 가짜 답변입니다.');
  const citation = askDialog.getByRole('link', { name: noteTitle });
  await expect(citation).toHaveAttribute('href', new RegExp(encodeURIComponent(savedNote.id || savedNote._id)));
  await citation.click();
  const citedNoteDialog = page.getByRole('dialog', { name: /연구노트 · v1/ });
  await expect(citedNoteDialog).toBeVisible();
  await citedNoteDialog.getByLabel('닫기').click();

  await page.getByRole('link', { name: '프로토콜', exact: true }).click();
  await page.getByRole('button', { name: 'AI 프로토콜 초안' }).click();
  const protocolAiDialog = page.getByRole('dialog', { name: 'AI 프로토콜 초안' });
  await protocolAiDialog.getByLabel('실험 지시사항').fill('시료를 준비하고 반응을 기록한다.');
  await protocolAiDialog.getByRole('button', { name: '초안 생성' }).click();
  await expect(protocolAiDialog).toContainText('E2E 가짜 프로토콜');
  await protocolAiDialog.getByRole('button', { name: '일반 편집기에서 열기' }).click();
  const protocolEditor = page.getByRole('dialog', { name: '새 프로토콜' });
  await expect(protocolEditor.getByRole('textbox', { name: '제목', exact: true })).toHaveValue('E2E 가짜 프로토콜');
  await protocolEditor.getByLabel('닫기').click();
});
