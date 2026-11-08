import { describe, it, expect } from 'vitest';
import { toNoteDoc, fromNoteDoc } from '../src/adapters.js';
import { validateDoc, normalizeDoc } from '@labhub/note-format';
import { htmlToDoc } from '@labhub/note-format/html';

describe('Round-trip tests', () => {
  it('모든 노드와 마크를 포함하는 고정 픽스처의 왕복 변환 및 정규화/유효성 검증', () => {
    const fullFixture = {
      type: 'doc',
      schemaVersion: 1,
      content: [
        {
          type: 'heading',
          attrs: { level: 1, align: 'center' },
          content: [{ type: 'text', text: '연구 보고서' }],
        },
        {
          type: 'paragraph',
          attrs: { align: 'justify' },
          content: [
            {
              type: 'text',
              text: '굵고 기울인 텍스트',
              marks: [
                { type: 'bold' },
                { type: 'italic' },
                { type: 'underline' },
                { type: 'strike' },
                { type: 'code' },
                { type: 'subscript' },
                { type: 'superscript' },
                { type: 'link', attrs: { href: 'https://labhub.internal/test', title: '참고' } },
              ],
            },
            { type: 'hardBreak' },
            { type: 'mathInline', attrs: { latex: 'E=mc^2' } },
            { type: 'mention', attrs: { userId: 'usr-1', label: '연구원' } },
            { type: 'noteLink', attrs: { noteId: 'note-1', label: '실험노트A' } },
            { type: 'reagentRef', attrs: { reagentId: 'rg-1', label: '에탄올' } },
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
          attrs: { start: 2 },
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
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '인용문 블록' }] }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: "console.log('test');" }],
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
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '헤더1' }] }],
                },
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1 },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '셀1' }] }],
                },
              ],
            },
          ],
        },
        { type: 'horizontalRule' },
        {
          type: 'image',
          attrs: { attachmentId: 'att-100', alt: '테스트 이미지', width: 400 },
        },
        {
          type: 'mathBlock',
          attrs: { latex: '\\sum_{i=1}^n x_i' },
        },
      ],
    };

    const pmJson = fromNoteDoc(fullFixture);
    const roundTripped = toNoteDoc(pmJson);

    expect(roundTripped).toEqual(normalizeDoc(fullFixture));
    const validation = validateDoc(roundTripped);
    expect(validation.ok).toBe(true);
  });

  it('시드 고정 HTML 생성기로 생성된 문서 최소 500건에 대한 왕복 변환 검증', () => {
    function createPrng(seed = 123456) {
      let s = seed >>> 0;
      return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const WORDS = ['실험', '연구', 'Sample', 'DNA', '온도', 'Buffer', '25.4', '&amp;', '&lt;'];
    const INLINE_TAGS = ['strong', 'em', 'u', 's', 'code', 'sub', 'sup'];

    function randChoice(prng, arr) {
      return arr[Math.floor(prng() * arr.length)];
    }

    function randInt(prng, min, max) {
      return Math.floor(prng() * (max - min + 1)) + min;
    }

    function generateHtml(prng) {
      const blockCount = randInt(prng, 1, 3);
      const blocks = [];

      for (let b = 0; b < blockCount; b++) {
        const r = prng();
        if (r < 0.4) {
          const tag = randChoice(prng, INLINE_TAGS);
          blocks.push(`<p class="ql-align-center"><${tag}>${randChoice(prng, WORDS)} ${randChoice(prng, WORDS)}</${tag}></p>`);
        } else if (r < 0.6) {
          blocks.push(`<h2>${randChoice(prng, WORDS)}</h2>`);
        } else if (r < 0.8) {
          blocks.push(`<ul><li data-list="bullet">${randChoice(prng, WORDS)}</li></ul>`);
        } else {
          blocks.push(`<table><thead><tr><th>${randChoice(prng, WORDS)}</th></tr></thead><tbody><tr><td>${randChoice(prng, WORDS)}</td></tr></tbody></table>`);
        }
      }

      return blocks.join('\n');
    }

    const SEED = 20261108;
    const prng = createPrng(SEED);
    const TOTAL_CASES = 500;

    for (let i = 0; i < TOTAL_CASES; i++) {
      const html = generateHtml(prng);
      const { doc } = htmlToDoc(html);

      const pmJson = fromNoteDoc(doc);
      const roundTripped = toNoteDoc(pmJson);

      expect(roundTripped, `Case ${i} failed equality`).toEqual(normalizeDoc(doc));
      const validation = validateDoc(roundTripped);
      expect(validation.ok, `Case ${i} failed validation: ${JSON.stringify(validation.errors)}`).toBe(true);
    }
  });
});
