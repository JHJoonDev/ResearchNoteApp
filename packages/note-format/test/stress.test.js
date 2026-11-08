import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDoc } from '../src/validate.js';
import { walkDoc } from '../src/walk.js';
import { normalizeDoc } from '../src/normalize.js';
import { docToPlainText } from '../src/plain-text.js';
import { docToSafeHtml } from '../src/safe-html.js';

test('stress - 깊이 10만 중첩 입력에서 스택 오버플로 크래시 없음', () => {
  // 깊이 100,000인 악의적인 중첩 객체 생성
  let current = { type: 'paragraph', content: [{ type: 'text', text: '바닥' }] };
  const targetDepth = 100_000;

  for (let d = 0; d < targetDepth; d++) {
    current = {
      type: 'blockquote',
      content: [current],
    };
  }

  const deepDoc = {
    type: 'doc',
    schemaVersion: 1,
    content: [current],
  };

  // 1) validateDoc이 Maximum call stack size exceeded 크래시 없이 maxDepth 에러를 정상 반환하는지 검증
  const res = validateDoc(deepDoc);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.message.includes('최대 중첩 깊이')));

  // 2) walkDoc이 10만 깊이에서도 크래시 없이 순회 가능한지 검증 (visitor에서 false 반환 등으로 제어 가능)
  let visitedCount = 0;
  walkDoc(deepDoc, () => {
    visitedCount++;
    if (visitedCount > 100) return false; // 상위 100개만 방문 후 건너뜀
  });
  assert.ok(visitedCount > 0);

  // 3) normalizeDoc, docToPlainText, docToSafeHtml이 스택 오버플로 크래시 없이 RangeError를 발생시키는지 검증
  assert.throws(
    () => normalizeDoc(deepDoc),
    (err) => err instanceof RangeError && err.message.includes('문서 중첩 깊이 한도'),
  );

  assert.throws(
    () => docToPlainText(deepDoc),
    (err) => err instanceof RangeError && err.message.includes('문서 중첩 깊이 한도'),
  );

  assert.throws(
    () => docToSafeHtml(deepDoc),
    (err) => err instanceof RangeError && err.message.includes('문서 중첩 깊이 한도'),
  );
});

test('stress - 1만 노드 대용량 문서 처리 시간 상한 검증 (각 단계별 < 500ms)', () => {
  const blocks = [];
  const count = 10_000;

  for (let i = 0; i < count; i++) {
    blocks.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: `단락 번호 ${i}: 연구 결과 데이터 측정치 ` },
        { type: 'text', text: `${i * 1.5}`, marks: [{ type: 'bold' }] },
      ],
    });
  }

  const bigDoc = {
    type: 'doc',
    schemaVersion: 1,
    content: blocks,
  };

  // validateDoc 성능
  const t0 = performance.now();
  const vRes = validateDoc(bigDoc);
  const t1 = performance.now();
  assert.equal(vRes.ok, true);
  assert.ok(t1 - t0 < 500, `validateDoc 소요 시간(${t1 - t0}ms) 초과`);

  // normalizeDoc 성능
  const t2 = performance.now();
  const nDoc = normalizeDoc(bigDoc);
  const t3 = performance.now();
  assert.ok(t3 - t2 < 500, `normalizeDoc 소요 시간(${t3 - t2}ms) 초과`);

  // docToPlainText 성능
  const t4 = performance.now();
  const plain = docToPlainText(nDoc);
  const t5 = performance.now();
  assert.ok(plain.length > 0);
  assert.ok(t5 - t4 < 500, `docToPlainText 소요 시간(${t5 - t4}ms) 초과`);

  // docToSafeHtml 성능
  const t6 = performance.now();
  const html = docToSafeHtml(nDoc);
  const t7 = performance.now();
  assert.ok(html.length > 0);
  assert.ok(t7 - t6 < 500, `docToSafeHtml 소요 시간(${t7 - t6}ms) 초과`);
});
