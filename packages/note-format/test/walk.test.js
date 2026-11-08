import test from 'node:test';
import assert from 'node:assert/strict';
import { walkDoc } from '../src/walk.js';

test('walkDoc - 재귀 없이 모든 노드 순회', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'hardBreak' },
        ],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'quote' }],
          },
        ],
      },
    ],
  };

  const visitedTypes = [];
  walkDoc(doc, (node) => {
    visitedTypes.push(node.type);
  });

  assert.deepEqual(visitedTypes, [
    'doc',
    'paragraph',
    'text',
    'hardBreak',
    'blockquote',
    'paragraph',
    'text',
  ]);
});

test('walkDoc - visitor가 false 반환 시 자식 스킵', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'hello' }],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'quote' }],
          },
        ],
      },
    ],
  };

  const visitedTypes = [];
  walkDoc(doc, (node) => {
    visitedTypes.push(node.type);
    if (node.type === 'blockquote') {
      return false; // blockquote 자식 스킵
    }
  });

  assert.deepEqual(visitedTypes, ['doc', 'paragraph', 'text', 'blockquote']);
});
