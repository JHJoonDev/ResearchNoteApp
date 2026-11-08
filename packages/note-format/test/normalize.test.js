import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoc } from '../src/normalize.js';
import { SCHEMA_VERSION } from '../src/constants.js';

test('normalizeDoc - 빈 텍스트 노드 제거', () => {
  const doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '앞부분', marks: [{ type: 'bold' }] },
          { type: 'text', text: '' },
          { type: 'text', text: '뒷부분' },
        ],
      },
    ],
  };

  const normalized = normalizeDoc(doc);
  assert.equal(normalized.content[0].content.length, 2);
  assert.equal(normalized.content[0].content[0].text, '앞부분');
  assert.equal(normalized.content[0].content[1].text, '뒷부분');
});

test('normalizeDoc - 인접 동일 마크 텍스트 노드 병합', () => {
  const doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '굵은 ', marks: [{ type: 'bold' }] },
          { type: 'text', text: '글씨', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' 일반' },
          { type: 'text', text: ' 텍스트' },
        ],
      },
    ],
  };

  const normalized = normalizeDoc(doc);
  assert.equal(normalized.content[0].content.length, 2);
  assert.deepEqual(normalized.content[0].content[0], {
    type: 'text',
    marks: [{ type: 'bold' }],
    text: '굵은 글씨',
  });
  assert.deepEqual(normalized.content[0].content[1], {
    type: 'text',
    text: ' 일반 텍스트',
  });
});

test('normalizeDoc - 키 순서 고정', () => {
  const chaoticDoc = {
    content: [
      {
        text: 'hello',
        type: 'text',
      },
    ],
    schemaVersion: 1,
    type: 'doc',
  };

  const normalized = normalizeDoc(chaoticDoc);
  const keys = Object.keys(normalized);
  assert.deepEqual(keys, ['type', 'schemaVersion', 'content']);
});

test('normalizeDoc - 멱등성 (normalizeDoc(normalizeDoc(doc)) === normalizeDoc(doc))', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        attrs: { align: 'center' },
        content: [
          { type: 'text', text: 'A', marks: [{ type: 'italic' }, { type: 'bold' }] },
          { type: 'text', text: 'B', marks: [{ type: 'bold' }, { type: 'italic' }] },
          { type: 'text', text: '' },
          { type: 'text', text: 'C' },
        ],
      },
    ],
  };

  const pass1 = normalizeDoc(doc);
  const pass2 = normalizeDoc(pass1);
  assert.deepEqual(pass1, pass2);
  assert.equal(JSON.stringify(pass1), JSON.stringify(pass2));
});
