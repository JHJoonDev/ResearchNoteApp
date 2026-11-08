/**
 * @fileoverview 문서 정규화 모듈 (키 순서 고정, 빈 텍스트 노드 제거, 동일 마크 텍스트 병합)
 */

import { DEFAULT_LIMITS } from './constants.js';

const NODE_KEY_ORDER = ['type', 'schemaVersion', 'attrs', 'content', 'marks', 'text'];
const MARK_KEY_ORDER = ['type', 'attrs'];

/**
 * 객체의 키를 지정된 순서대로 정렬하여 새 객체를 생성합니다.
 * @param {Record<string, any>} obj
 * @param {string[]} [preferredOrder]
 * @returns {Record<string, any>}
 */
function sortObjectKeys(obj, preferredOrder = []) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted = {};
  const allKeys = Object.keys(obj);

  for (const k of preferredOrder) {
    if (k in obj) {
      sorted[k] = obj[k];
    }
  }

  const remainingKeys = allKeys.filter((k) => !preferredOrder.includes(k)).sort();
  for (const k of remainingKeys) {
    sorted[k] = obj[k];
  }

  return sorted;
}

/**
 * attrs 객체의 키를 알파벳 순으로 정렬합니다.
 * @param {Record<string, any>} attrs
 * @returns {Record<string, any>}
 */
function normalizeAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return attrs;
  return sortObjectKeys(attrs);
}

/**
 * mark 객체를 정규화합니다.
 * @param {import('./types.js').Mark} mark
 * @returns {import('./types.js').Mark}
 */
function normalizeMark(mark) {
  if (!mark || typeof mark !== 'object') return mark;
  const normalized = sortObjectKeys(mark, MARK_KEY_ORDER);
  if (normalized.attrs) {
    normalized.attrs = normalizeAttrs(normalized.attrs);
  }
  return normalized;
}

/**
 * marks 배열을 정규화합니다 (정렬 및 키 순서 고정).
 * @param {import('./types.js').Mark[]} [marks]
 * @returns {import('./types.js').Mark[] | undefined}
 */
function normalizeMarks(marks) {
  if (!Array.isArray(marks) || marks.length === 0) return undefined;
  const processed = marks.map((m) => normalizeMark(m));
  processed.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  });
  return processed;
}

/**
 * 두 마크 배열이 내용상 동일한지 비교합니다.
 * @param {import('./types.js').Mark[] | undefined} a
 * @param {import('./types.js').Mark[] | undefined} b
 * @returns {boolean}
 */
function areMarksEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 노드를 정규화합니다. 깊이 한도를 초과하면 RangeError를 발생시켜 스택 오버플로를 방지합니다.
 * @param {import('./types.js').Node} node
 * @param {number} depth
 * @param {number} maxDepth
 * @returns {import('./types.js').Node}
 */
function normalizeNode(node, depth, maxDepth) {
  if (!node || typeof node !== 'object') return node;

  if (depth > maxDepth) {
    throw new RangeError(`문서 중첩 깊이 한도(${maxDepth})를 초과했습니다.`);
  }

  const result = {};

  // type 복사
  if ('type' in node) result.type = node.type;
  if ('schemaVersion' in node) result.schemaVersion = node.schemaVersion;

  // attrs 복사 및 정규화
  if (node.attrs && typeof node.attrs === 'object') {
    result.attrs = normalizeAttrs(node.attrs);
  }

  // content 복사 및 정규화
  if (Array.isArray(node.content)) {
    const rawChildren = node.content.map((child) => normalizeNode(child, depth + 1, maxDepth));
    const normalizedChildren = [];

    for (const child of rawChildren) {
      if (!child) continue;

      // 빈 텍스트 노드 제거
      if (child.type === 'text' && (!child.text || child.text === '')) {
        continue;
      }

      // 인접한 동일 마크 텍스트 병합
      if (child.type === 'text' && normalizedChildren.length > 0) {
        const prevChild = normalizedChildren[normalizedChildren.length - 1];
        if (prevChild.type === 'text' && areMarksEqual(prevChild.marks, child.marks)) {
          prevChild.text += child.text;
          continue;
        }
      }

      normalizedChildren.push(child);
    }

    result.content = normalizedChildren;
  }

  // marks 복사 및 정규화
  if (Array.isArray(node.marks)) {
    const normalizedMarks = normalizeMarks(node.marks);
    if (normalizedMarks && normalizedMarks.length > 0) {
      result.marks = normalizedMarks;
    }
  }

  // text 복사
  if ('text' in node && typeof node.text === 'string') {
    result.text = node.text;
  }

  // 추가 필드가 있다면 알파벳 순으로 포함
  const sortedResult = sortObjectKeys(result, NODE_KEY_ORDER);
  for (const k of Object.keys(node)) {
    if (!(k in sortedResult)) {
      sortedResult[k] = node[k];
    }
  }

  return sortedResult;
}

/**
 * 문서를 정규화합니다. 키 순서 고정, 빈 텍스트 노드 제거, 인접 동일 마크 텍스트 병합.
 * 멱등성을 보장하며, 중첩 깊이가 options.maxDepth(기본 32)를 초과하면 RangeError를 발생시킵니다.
 *
 * @param {import('./types.js').Node} doc
 * @param {{ maxDepth?: number }} [options]
 * @returns {import('./types.js').Node}
 */
export function normalizeDoc(doc, options = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  const maxDepth = Number.isInteger(options?.maxDepth) ? options.maxDepth : DEFAULT_LIMITS.maxDepth;
  return normalizeNode(doc, 0, maxDepth);
}
