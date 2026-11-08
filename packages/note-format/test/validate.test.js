import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDoc } from '../src/validate.js';
import { SCHEMA_VERSION } from '../src/constants.js';

test('validateDoc - 기본 유효 문서', () => {
  const doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '안녕하세요' }],
      },
    ],
  };
  const res = validateDoc(doc);
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 0);
});

test('validateDoc - 모든 허용 노드 및 마크 통과', () => {
  const fullDoc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'heading',
        attrs: { level: 2, align: 'center' },
        content: [{ type: 'text', text: '제목' }],
      },
      {
        type: 'paragraph',
        attrs: { align: 'justify' },
        content: [
          {
            type: 'text',
            text: '강조 텍스트',
            marks: [
              { type: 'bold' },
              { type: 'italic' },
              { type: 'underline' },
              { type: 'strike' },
              { type: 'code' },
              { type: 'subscript' },
              { type: 'superscript' },
              { type: 'link', attrs: { href: 'https://example.com/test', title: '링크' } },
            ],
          },
          { type: 'hardBreak' },
          { type: 'mathInline', attrs: { latex: 'E=mc^2' } },
          { type: 'mention', attrs: { userId: 'u123', label: '홍길동' } },
          { type: 'noteLink', attrs: { noteId: 'n456', label: '연구 노트 #1' } },
          { type: 'reagentRef', attrs: { reagentId: 'r789', label: 'NaCl' } },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '불릿 항목' }] }],
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '번호 항목' }] }],
          },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '완료 항목' }] }],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '인용문' }] }],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [{ type: 'text', text: "console.log('hi');" }],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: { colspan: 1, rowspan: 1 },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '헤더' }] }],
              },
              {
                type: 'tableCell',
                attrs: { colspan: 2, rowspan: 1 },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '데이터' }] }],
              },
            ],
          },
        ],
      },
      { type: 'horizontalRule' },
      {
        type: 'image',
        attrs: { attachmentId: 'att-1234', alt: '실험 결과 사진', width: 600 },
      },
      {
        type: 'mathBlock',
        attrs: { latex: '\\int_0^1 x dx' },
      },
    ],
  };

  const res = validateDoc(fullDoc);
  assert.equal(res.ok, true, `유효성 검사 실패: ${JSON.stringify(res.errors)}`);
});

test('validateDoc - 허용되지 않는 노드 거부', () => {
  const invalidDoc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'unsupportedCustomNode',
        content: [],
      },
    ],
  };
  const res = validateDoc(invalidDoc);
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /알 수 없는 노드 타입/);
});

test('validateDoc - javascript: 및 비허용 링크 거부', () => {
  const dangerousUrls = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(document.cookie)',
    '  javascript:void(0)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '/relative/path',
  ];

  for (const href of dangerousUrls) {
    const doc = {
      type: 'doc',
      schemaVersion: SCHEMA_VERSION,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '클릭',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
      ],
    };
    const res = validateDoc(doc);
    assert.equal(res.ok, false, `링크 '${href}'가 거부되어야 함`);
  }
});

test('validateDoc - http, https, mailto 허용', () => {
  const validUrls = [
    'https://example.com',
    'http://localhost:3000/api',
    'mailto:researcher@example.com',
  ];

  for (const href of validUrls) {
    const doc = {
      type: 'doc',
      schemaVersion: SCHEMA_VERSION,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '링크',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
      ],
    };
    const res = validateDoc(doc);
    assert.equal(res.ok, true, `링크 '${href}'는 허용되어야 함`);
  }
});

test('validateDoc - image에 src 속성 거부 및 attachmentId 필수', () => {
  const docWithSrc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'image',
        attrs: { attachmentId: 'att1', src: 'https://evil.com/leak.png' },
      },
    ],
  };
  const res = validateDoc(docWithSrc);
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /src 속성은 금지됩니다/);
});

test('validateDoc - heading level 1, 2, 3 외 거부', () => {
  const doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'heading',
        attrs: { level: 4 },
        content: [{ type: 'text', text: 'H4' }],
      },
    ],
  };
  const res = validateDoc(doc);
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /level은 1, 2, 3 중 하나/);
});

test('validateDoc - codeBlock 내부 marks 거부', () => {
  const doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'codeBlock',
        attrs: { language: 'js' },
        content: [
          {
            type: 'text',
            text: 'code',
            marks: [{ type: 'bold' }],
          },
        ],
      },
    ],
  };
  const res = validateDoc(doc);
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /codeBlock 내부 텍스트에는 marks를 지정할 수 없습니다/);
});

test('validateDoc - 잘못된 중첩(bulletList 안의 paragraph 직접 배치) 거부', () => {
  const doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '오류' }],
          },
        ],
      },
    ],
  };
  const res = validateDoc(doc);
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /자식은 'listItem'이어야 하나/);
});
