/**
 * @fileoverview noteToRecord 및 개별 유닛 단위 테스트
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { noteToRecord } from '../src/record.js';
import { validateAccess, escapeMeiliString, buildMeiliFilter } from '../src/access.js';
import { extractTokens, createSnippet } from '../src/korean.js';

describe('Unit Tests: noteToRecord', () => {
  test('converts note-format doc input correctly', () => {
    const docNote = {
      id: 'doc-note-1',
      title: '구조화 노트',
      tags: ['doc', 'format'],
      projectId: 'p100',
      authorId: 'user1',
      status: 'approved',
      isDeleted: false,
      updatedAt: '2026-11-08T12:00:00Z',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '블록 기반 구조화 문서의 본문 내용입니다.' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '두 번째 소제목' }],
          },
        ],
      },
    };

    const record = noteToRecord(docNote);
    assert.strictEqual(record.id, 'doc-note-1');
    assert.strictEqual(record.title, '구조화 노트');
    assert.strictEqual(record.type, 'note');
    assert.ok(record.text.includes('블록 기반 구조화 문서의 본문'));
    assert.ok(record.text.includes('두 번째 소제목'));
    assert.deepStrictEqual(record.tags, ['doc', 'format']);
    assert.strictEqual(record.projectId, 'p100');
    assert.strictEqual(record.authorId, 'user1');
  });

  test('converts legacy HTML content input correctly', () => {
    const htmlNote = {
      _id: 'html-note-1',
      title: '레거시 HTML 노트',
      tags: ['legacy'],
      projectId: null,
      authorId: 'user2',
      content: '<p>과거 버전에서 작성된 <strong>HTML</strong> 본문입니다.</p><ul><li>항목 A</li><li>항목 B</li></ul>',
    };

    const record = noteToRecord(htmlNote);
    assert.strictEqual(record.id, 'html-note-1');
    assert.strictEqual(record.title, '레거시 HTML 노트');
    assert.ok(record.text.includes('과거 버전에서 작성된 HTML 본문입니다'));
    assert.ok(record.text.includes('항목 A'));
    assert.strictEqual(record.projectId, null);
    assert.strictEqual(record.authorId, 'user2');
  });

  test('does not throw on inconvertible content and indexes title/tags with a warning', () => {
    const warnedLogs = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnedLogs.push(args.join(' '));
    };

    try {
      // 순환 참조 또는 손상된 깊이 한도 초과 doc
      const cyclicDoc = { type: 'doc', content: [] };
      let cur = cyclicDoc;
      for (let i = 0; i < 50; i++) {
        const next = { type: 'paragraph', content: [] };
        cur.content.push(next);
        cur = next;
      }
      cur.content.push({ type: 'text', text: '초과 깊이' });

      const invalidNote = {
        id: 'broken-note-1',
        title: '손상된 문서',
        tags: ['broken', 'recovery'],
        projectId: 'p_broken',
        authorId: 'user3',
        content: cyclicDoc,
      };

      const record = noteToRecord(invalidNote);

      assert.strictEqual(record.id, 'broken-note-1');
      assert.strictEqual(record.title, '손상된 문서');
      assert.deepStrictEqual(record.tags, ['broken', 'recovery']);
      assert.strictEqual(record.text, '', '변환 실패 시 텍스트는 빈 문자열로 안전하게 처리');
      assert.ok(warnedLogs.length > 0, '변환 실패에 대한 warning이 기록되어야 함');
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('Unit Tests: access & escaping', () => {
  test('escapeMeiliString escapes quotes, backslashes and control characters', () => {
    assert.strictEqual(escapeMeiliString('normal'), 'normal');
    assert.strictEqual(escapeMeiliString('test"quote'), 'test\\"quote');
    assert.strictEqual(escapeMeiliString('back\\slash'), 'back\\\\slash');
    assert.strictEqual(escapeMeiliString('line\nbreak'), 'line\\nbreak');
    assert.strictEqual(escapeMeiliString(null), '');
  });

  test('buildMeiliFilter creates strict expression preventing injection', () => {
    const access = {
      projectIds: ['p1', 'p2" OR "1"="1'],
      authorId: 'userA',
    };
    const filters = {
      type: 'note',
      status: 'active',
      tags: ['tag1'],
    };

    const expr = buildMeiliFilter(access, filters);
    assert.ok(expr.includes('isDeleted = false'));
    assert.ok(expr.includes('authorId = "userA"'));
    assert.ok(expr.includes('p2\\" OR \\"1\\"=\\"1'));
    assert.ok(expr.includes('type = "note"'));
    assert.ok(expr.includes('tags = "tag1"'));
  });
});

describe('Unit Tests: korean tokenization & snippet', () => {
  test('extractTokens creates bigrams for Korean terms', () => {
    const res = extractTokens('완충용액 완충');
    assert.ok(res.words.includes('완충용액'));
    assert.ok(res.words.includes('완충'));
    assert.ok(res.bigrams.includes('완충'));
    assert.ok(res.bigrams.includes('충용'));
    assert.ok(res.bigrams.includes('용액'));
  });

  test('createSnippet highlights matched query terms', () => {
    const text = '이 실험에서는 특정 완충용액을 사용하여 단백질 변성을 억제합니다.';
    const snip = createSnippet(text, '완충용액', 50);
    assert.ok(snip.includes('<mark>완충용액</mark>'));
  });
});
