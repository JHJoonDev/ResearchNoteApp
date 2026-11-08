/**
 * @fileoverview 검색 색인용 평문 추출 모듈
 */

import { DEFAULT_LIMITS } from './constants.js';

/**
 * 단일 노드 또는 서브트리에서 평문을 추출합니다. 깊이 한도를 초과하면 RangeError를 발생시킵니다.
 * @param {import('./types.js').Node} node
 * @param {number} depth
 * @param {number} maxDepth
 * @returns {string}
 */
function nodeToPlainText(node, depth, maxDepth) {
  if (!node || typeof node !== 'object') return '';

  if (depth > maxDepth) {
    throw new RangeError(`문서 중첩 깊이 한도(${maxDepth})를 초과했습니다.`);
  }

  const { type, attrs, content, text } = node;

  switch (type) {
    case 'text':
      return typeof text === 'string' ? text : '';

    case 'hardBreak':
      return '\n';

    case 'mathInline':
      return attrs?.latex || '';

    case 'mathBlock':
      return attrs?.latex ? `${attrs.latex}\n` : '';

    case 'mention':
    case 'noteLink':
    case 'reagentRef':
      return attrs?.label || '';

    case 'image':
      return attrs?.alt ? `[이미지: ${attrs.alt}]` : '';

    case 'horizontalRule':
      return '\n';

    case 'table': {
      if (!Array.isArray(content)) return '';
      return (
        content
          .map((row) => nodeToPlainText(row, depth + 1, maxDepth))
          .filter((line) => line.length > 0)
          .join('\n') + '\n'
      );
    }

    case 'tableRow': {
      if (!Array.isArray(content)) return '';
      return content.map((cell) => nodeToPlainText(cell, depth + 1, maxDepth).trim()).join('\t');
    }

    case 'tableHeader':
    case 'tableCell': {
      if (!Array.isArray(content)) return '';
      return content.map((c) => nodeToPlainText(c, depth + 1, maxDepth)).join(' ').trim();
    }

    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      if (!Array.isArray(content)) return '';
      return (
        content
          .map((item) => nodeToPlainText(item, depth + 1, maxDepth))
          .filter((line) => line.length > 0)
          .join('\n') + '\n'
      );
    }

    case 'listItem':
    case 'taskItem':
    case 'blockquote': {
      if (!Array.isArray(content)) return '';
      return content.map((c) => nodeToPlainText(c, depth + 1, maxDepth)).join('\n');
    }

    case 'paragraph':
    case 'heading':
    case 'codeBlock': {
      if (!Array.isArray(content)) return '\n';
      const inner = content.map((c) => nodeToPlainText(c, depth + 1, maxDepth)).join('');
      return `${inner}\n`;
    }

    case 'doc': {
      if (!Array.isArray(content)) return '';
      return content
        .map((c) => nodeToPlainText(c, depth + 1, maxDepth))
        .join('')
        .trim();
    }

    default: {
      if (Array.isArray(content)) {
        return content.map((c) => nodeToPlainText(c, depth + 1, maxDepth)).join('');
      }
      return '';
    }
  }
}

/**
 * 문서를 평문 문자열로 변환합니다.
 * - 블록 사이 줄바꿈
 * - 표는 셀을 탭(\t)으로 구분, 행은 줄바꿈(\n)
 * - 수식은 latex 원문
 * - 멘션/링크/시약 참조는 label
 * 중첩 깊이가 options.maxDepth(기본 32)를 초과하면 RangeError를 발생시킵니다.
 *
 * @param {import('./types.js').Node} doc
 * @param {{ maxDepth?: number }} [options]
 * @returns {string}
 */
export function docToPlainText(doc, options = {}) {
  if (!doc || typeof doc !== 'object') return '';
  const maxDepth = Number.isInteger(options?.maxDepth) ? options.maxDepth : DEFAULT_LIMITS.maxDepth;
  return nodeToPlainText(doc, 0, maxDepth);
}
