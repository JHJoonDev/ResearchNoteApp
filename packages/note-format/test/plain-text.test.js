import test from 'node:test';
import assert from 'node:assert/strict';
import { docToPlainText } from '../src/plain-text.js';

test('docToPlainText - 블록 사이 줄바꿈 및 인라인 요소 변환', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: '1. 실험 목적' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '본 연구는 ' },
          { type: 'mention', attrs: { userId: 'u1', label: '김연구원' } },
          { type: 'text', text: '과 함께 진행하며 ' },
          { type: 'reagentRef', attrs: { reagentId: 'r1', label: '에탄올' } },
          { type: 'text', text: '을 사용한다.' },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '참고 노트는 ' },
          { type: 'noteLink', attrs: { noteId: 'n1', label: '2026-03 실험노트' } },
          { type: 'text', text: '이다.' },
        ],
      },
    ],
  };

  const text = docToPlainText(doc);
  assert.match(text, /1\. 실험 목적/);
  assert.match(text, /김연구원과 함께 진행하며 에탄올을 사용한다\./);
  assert.match(text, /참고 노트는 2026-03 실험노트이다\./);
});

test('docToPlainText - 표는 셀을 탭으로 구분하고 행을 줄바꿈으로 구분', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '시료' }] }],
              },
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '농도' }] }],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sample A' }] }],
              },
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '10 mg/mL' }] }],
              },
            ],
          },
        ],
      },
    ],
  };

  const text = docToPlainText(doc);
  const lines = text.split('\n').filter(Boolean);
  assert.equal(lines[0], '시료\t농도');
  assert.equal(lines[1], 'Sample A\t10 mg/mL');
});

test('docToPlainText - 수식은 latex 원문 그대로 추출', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '인라인 수식: ' },
          { type: 'mathInline', attrs: { latex: '\\alpha + \\beta' } },
        ],
      },
      {
        type: 'mathBlock',
        attrs: { latex: '\\sum_{i=1}^n x_i = X' },
      },
    ],
  };

  const text = docToPlainText(doc);
  assert.match(text, /\\alpha \+ \\beta/);
  assert.match(text, /\\sum_\{i=1\}\^n x_i = X/);
});
