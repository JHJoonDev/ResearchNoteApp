import test from 'node:test';
import assert from 'node:assert/strict';
import { diffDocs, diffInlineText, tokenizeText } from '../src/diff.js';

test('tokenizeText - 한국어 단어, 공백, 문장부호 분리', () => {
  const text = '실험을 10회 진행했다.';
  const tokens = tokenizeText(text);
  assert.deepEqual(tokens, ['실험을', ' ', '10', '회', ' ', '진행했다', '.']);
});

test('diffInlineText - 한국어 텍스트 변경 인라인 diff', () => {
  const textA = '시약 10ml를 투입하고 반응을 관찰했다.';
  const textB = '시약 20ml를 투입하고 반응을 기록했다.';

  const inlineDiff = diffInlineText(textA, textB);
  // same: "시약 "
  // remove: "10"
  // add: "20"
  // same: "ml를 투입하고 반응을 "
  // remove: "관찰했다"
  // add: "기록했다"
  // same: "."
  assert.ok(inlineDiff.some((d) => d.op === 'remove' && d.text === '10'));
  assert.ok(inlineDiff.some((d) => d.op === 'add' && d.text === '20'));
  assert.ok(inlineDiff.some((d) => d.op === 'remove' && d.text === '관찰했다'));
  assert.ok(inlineDiff.some((d) => d.op === 'add' && d.text === '기록했다'));
});

test('diffDocs - 블록 단위 비교 및 change 인라인 diff', () => {
  const docA = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: '실험 보고서 초안' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '온도를 25도로 유지한다.' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '삭제될 단락입니다.' }],
      },
    ],
  };

  const docB = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: '실험 보고서 최종본' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '온도를 30도로 유지한다.' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '새로 추가된 결론입니다.' }],
      },
    ],
  };

  const diffs = diffDocs(docA, docB);

  // 3개 블록 모두 변경됨
  assert.equal(diffs.length, 3);
  assert.equal(diffs[0].op, 'change');
  assert.equal(diffs[0].blockIndexA, 0);
  assert.equal(diffs[0].blockIndexB, 0);
  assert.ok(diffs[0].inline);

  assert.equal(diffs[1].op, 'change');
  assert.equal(diffs[1].blockIndexA, 1);
  assert.equal(diffs[1].blockIndexB, 1);

  assert.equal(diffs[2].op, 'change');
});

test('diffDocs - 완전 일치(same), 단독 삭제(remove), 단독 추가(add)', () => {
  const docA = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '공통 단락' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '삭제 대상' }] },
    ],
  };

  const docB = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '공통 단락' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '신규 추가' }] },
    ],
  };

  const diffs = diffDocs(docA, docB);
  assert.equal(diffs[0].op, 'same');
  assert.equal(diffs[0].blockIndexA, 0);
  assert.equal(diffs[0].blockIndexB, 0);

  assert.equal(diffs[1].op, 'change');
  assert.equal(diffs[1].blockIndexA, 1);
  assert.equal(diffs[1].blockIndexB, 1);
});
