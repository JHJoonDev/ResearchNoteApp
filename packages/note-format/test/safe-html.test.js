import test from 'node:test';
import assert from 'node:assert/strict';
import { docToSafeHtml } from '../src/safe-html.js';

test('docToSafeHtml - <script> 및 이벤트 속성 무해성 검증', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '<script>alert("XSS")</script><img src=x onerror=alert(1)>',
          },
        ],
      },
    ],
  };

  const html = docToSafeHtml(doc);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('docToSafeHtml - image는 <img data-attachment-id>로 내보내고 src는 만들지 않음', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'image',
        attrs: {
          attachmentId: 'att-safe-001',
          alt: '현미경 사진 <위험태그>',
          width: 500,
        },
      },
    ],
  };

  const html = docToSafeHtml(doc);
  assert.ok(html.includes('<img data-attachment-id="att-safe-001"'));
  assert.ok(html.includes('alt="현미경 사진 &lt;위험태그&gt;"'));
  assert.ok(html.includes('width="500"'));
  assert.ok(!html.includes('src='));
});

test('docToSafeHtml - javascript: 링크 무력화', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '악성 링크',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      },
    ],
  };

  const html = docToSafeHtml(doc);
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('<a href='));
  assert.ok(html.includes('악성 링크'));
});

test('docToSafeHtml - 정렬 및 마크 렌더링', () => {
  const doc = {
    type: 'doc',
    schemaVersion: 1,
    content: [
      {
        type: 'paragraph',
        attrs: { align: 'center' },
        content: [
          {
            type: 'text',
            text: '중앙 정렬 굵은 글씨',
            marks: [{ type: 'bold' }],
          },
        ],
      },
    ],
  };

  const html = docToSafeHtml(doc);
  assert.equal(html, '<p style="text-align: center;"><strong>중앙 정렬 굵은 글씨</strong></p>');
});
