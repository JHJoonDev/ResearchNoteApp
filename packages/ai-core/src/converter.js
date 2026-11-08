/**
 * @fileoverview AI draftNote 출력 구조를 @labhub/note-format 문서로 변환하고 validateDoc으로 검증
 */

import { validateDoc, SCHEMA_VERSION } from '@labhub/note-format';
import { AiError } from './errors.js';

/**
 * draftNote의 flat sections 구조를 ProseMirror 호환 @labhub/note-format doc으로 변환합니다.
 *
 * @param {Array<{
 *   heading: string,
 *   blocks: Array<{
 *     kind: 'paragraph'|'bullets'|'table',
 *     text?: string,
 *     items?: string[],
 *     header?: string[],
 *     rows?: string[][]
 *   }>
 * }>} sections
 * @returns {object} note-format 호환 doc 객체
 */
export function sectionsToDoc(sections) {
  const content = [];

  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue;

      // 섹션 제목(Heading)
      if (typeof section.heading === 'string' && section.heading.trim().length > 0) {
        content.push({
          type: 'heading',
          attrs: { level: 2 },
          content: [
            {
              type: 'text',
              text: section.heading,
            },
          ],
        });
      }

      // 섹션 내 블록들
      if (Array.isArray(section.blocks)) {
        for (const block of section.blocks) {
          if (!block || typeof block !== 'object') continue;

          if (block.kind === 'paragraph') {
            const text = typeof block.text === 'string' ? block.text : '';
            if (text.length > 0) {
              content.push({
                type: 'paragraph',
                content: [{ type: 'text', text }],
              });
            } else {
              content.push({
                type: 'paragraph',
              });
            }
          } else if (block.kind === 'bullets') {
            const items = Array.isArray(block.items) ? block.items : [];
            const listItems = [];
            for (const item of items) {
              const itemText = typeof item === 'string' ? item : '';
              listItems.push({
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    ...(itemText.length > 0
                      ? { content: [{ type: 'text', text: itemText }] }
                      : {}),
                  },
                ],
              });
            }
            if (listItems.length > 0) {
              content.push({
                type: 'bulletList',
                content: listItems,
              });
            }
          } else if (block.kind === 'table') {
            const tableRows = [];

            // 테이블 헤더
            if (Array.isArray(block.header) && block.header.length > 0) {
              const headerCells = block.header.map(cell => {
                const cellText = typeof cell === 'string' ? cell : '';
                return {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      ...(cellText.length > 0
                        ? { content: [{ type: 'text', text: cellText }] }
                        : {}),
                    },
                  ],
                };
              });
              tableRows.push({
                type: 'tableRow',
                content: headerCells,
              });
            }

            // 테이블 데이터 행
            if (Array.isArray(block.rows)) {
              for (const row of block.rows) {
                if (!Array.isArray(row)) continue;
                const cells = row.map(cell => {
                  const cellText = typeof cell === 'string' ? cell : '';
                  return {
                    type: 'tableCell',
                    content: [
                      {
                        type: 'paragraph',
                        ...(cellText.length > 0
                          ? { content: [{ type: 'text', text: cellText }] }
                          : {}),
                      },
                    ],
                  };
                });
                tableRows.push({
                  type: 'tableRow',
                  content: cells,
                });
              }
            }

            if (tableRows.length > 0) {
              content.push({
                type: 'table',
                content: tableRows,
              });
            }
          }
        }
      }
    }
  }

  const doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content,
  };

  const validation = validateDoc(doc);
  if (!validation.ok) {
    const errorDetails = validation.errors.map(e => `${e.path}: ${e.message}`).join('; ');
    throw new AiError(`Generated document failed validation: ${errorDetails}`, {
      code: 'unknown',
    });
  }

  return doc;
}
