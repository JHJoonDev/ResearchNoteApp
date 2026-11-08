/**
 * @fileoverview ProseMirror JSON 호환 문서 유효성 검사 모듈
 */

import {
  SCHEMA_VERSION,
  DEFAULT_LIMITS,
  ALLOWED_ALIGNMENTS,
  ALLOWED_BLOCK_TYPES,
  ALLOWED_INLINE_TYPES,
  ALLOWED_MARK_TYPES,
} from './constants.js';

const TOP_LEVEL_BLOCKS = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'table',
  'horizontalRule',
  'image',
  'mathBlock',
]);

const INLINE_SET = new Set(ALLOWED_INLINE_TYPES);
const BLOCK_SET = new Set(ALLOWED_BLOCK_TYPES);
const MARK_SET = new Set(ALLOWED_MARK_TYPES);

/**
 * link.href가 http, https, mailto 스킴인지 검사합니다.
 * @param {string} href
 * @returns {boolean}
 */
export function isValidLinkHref(href) {
  if (typeof href !== 'string' || !href.trim()) return false;
  const trimmed = href.trim();
  // 제어 문자 차단
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;
  // javascript, data, vbscript 등 차단
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return false;
  // http, https, mailto 스킴만 허용
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed);
}

/**
 * 문서의 유효성을 검사합니다. 스택 오버플로를 방지하기 위해 재귀 대신 스택을 사용합니다.
 *
 * @param {any} doc
 * @param {import('./types.js').ValidationLimits} [limits]
 * @returns {import('./types.js').ValidationResult}
 */
export function validateDoc(doc, limits = {}) {
  const errors = [];
  const maxNodes = Number.isInteger(limits?.maxNodes) ? limits.maxNodes : DEFAULT_LIMITS.maxNodes;
  const maxDepth = Number.isInteger(limits?.maxDepth) ? limits.maxDepth : DEFAULT_LIMITS.maxDepth;
  const maxTextLength = Number.isInteger(limits?.maxTextLength)
    ? limits.maxTextLength
    : DEFAULT_LIMITS.maxTextLength;

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: [{ path: 'doc', message: '문서는 객체여야 합니다.' }] };
  }

  if (doc.type !== 'doc') {
    errors.push({ path: 'doc/type', message: "최상위 type은 'doc'이어야 합니다." });
  }

  if (doc.schemaVersion !== SCHEMA_VERSION) {
    errors.push({
      path: 'doc/schemaVersion',
      message: `schemaVersion은 ${SCHEMA_VERSION}이어야 합니다.`,
    });
  }

  if (!Array.isArray(doc.content)) {
    errors.push({ path: 'doc/content', message: '최상위 content는 배열이어야 합니다.' });
    return { ok: false, errors };
  }

  // 최상위 객체 키 검사
  const docKeys = Object.keys(doc);
  for (const k of docKeys) {
    if (!['type', 'schemaVersion', 'content'].includes(k)) {
      errors.push({ path: `doc/${k}`, message: `최상위 문서에 허용되지 않은 속성 '${k}'가 있습니다.` });
    }
  }

  let totalNodes = 1; // root doc count
  let totalTextLength = 0;

  // Stack item: [node, path, depth, parentType, isInsideCodeBlock]
  const stack = [];

  for (let i = doc.content.length - 1; i >= 0; i--) {
    stack.push([doc.content[i], `doc/content/${i}`, 1, 'doc', false]);
  }

  while (stack.length > 0) {
    const [node, path, depth, parentType, isInsideCodeBlock] = stack.pop();
    totalNodes++;

    if (totalNodes > maxNodes) {
      errors.push({ path: 'doc', message: `최대 노드 수(${maxNodes})를 초과했습니다.` });
      return { ok: false, errors };
    }

    if (depth > maxDepth) {
      errors.push({ path, message: `최대 중첩 깊이(${maxDepth})를 초과했습니다.` });
      // 깊이 초과 시 자식은 더 이상 탐색하지 않고 continue
      continue;
    }

    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push({ path, message: '노드는 객체여야 합니다.' });
      continue;
    }

    const { type, attrs, content, marks, text } = node;

    if (typeof type !== 'string') {
      errors.push({ path: `${path}/type`, message: '노드 type은 문자열이어야 합니다.' });
      continue;
    }

    const isBlock = BLOCK_SET.has(type);
    const isInline = INLINE_SET.has(type);

    if (!isBlock && !isInline) {
      errors.push({ path: `${path}/type`, message: `알 수 없는 노드 타입 '${type}'입니다.` });
      continue;
    }

    // 허용되지 않은 키 검사
    const nodeKeys = Object.keys(node);
    for (const k of nodeKeys) {
      if (!['type', 'attrs', 'content', 'marks', 'text'].includes(k)) {
        errors.push({ path: `${path}/${k}`, message: `노드에 허용되지 않은 속성 '${k}'가 있습니다.` });
      }
    }

    // 부모-자식 관계 검사
    if (parentType === 'doc') {
      if (!TOP_LEVEL_BLOCKS.has(type)) {
        errors.push({
          path,
          message: `최상위 content에는 '${type}' 노드가 올 수 없습니다.`,
        });
      }
    } else if (parentType === 'paragraph' || parentType === 'heading') {
      if (!isInline) {
        errors.push({
          path,
          message: `'${parentType}'의 자식으로 인라인 노드만 올 수 있으나 '${type}'이(가) 있습니다.`,
        });
      }
    } else if (parentType === 'bulletList' || parentType === 'orderedList') {
      if (type !== 'listItem') {
        errors.push({
          path,
          message: `'${parentType}'의 자식은 'listItem'이어야 하나 '${type}'이(가) 있습니다.`,
        });
      }
    } else if (parentType === 'taskList') {
      if (type !== 'taskItem') {
        errors.push({
          path,
          message: `'taskList'의 자식은 'taskItem'이어야 하나 '${type}'이(가) 있습니다.`,
        });
      }
    } else if (parentType === 'listItem' || parentType === 'blockquote' || parentType === 'taskItem') {
      if (!isBlock) {
        errors.push({
          path,
          message: `'${parentType}'의 자식은 블록 노드여야 하나 '${type}'이(가) 있습니다.`,
        });
      }
      if (['listItem', 'taskItem', 'tableRow', 'tableHeader', 'tableCell'].includes(type)) {
        errors.push({
          path,
          message: `'${parentType}'의 자식으로 '${type}'이 직접 올 수 없습니다.`,
        });
      }
    } else if (parentType === 'table') {
      if (type !== 'tableRow') {
        errors.push({
          path,
          message: `'table'의 자식은 'tableRow'이어야 하나 '${type}'이(가) 있습니다.`,
        });
      }
    } else if (parentType === 'tableRow') {
      if (type !== 'tableHeader' && type !== 'tableCell') {
        errors.push({
          path,
          message: `'tableRow'의 자식은 'tableHeader' 또는 'tableCell'이어야 하나 '${type}'이(가) 있습니다.`,
        });
      }
    } else if (parentType === 'tableHeader' || parentType === 'tableCell') {
      if (!isBlock || ['listItem', 'taskItem', 'tableRow', 'tableHeader', 'tableCell'].includes(type)) {
        errors.push({
          path,
          message: `'${parentType}'의 자식은 일반 블록 노드여야 합니다.`,
        });
      }
    } else if (parentType === 'codeBlock') {
      if (type !== 'text') {
        errors.push({
          path,
          message: `'codeBlock'의 자식은 'text' 노드만 허용됩니다.`,
        });
      }
    }

    // 마크 검사 (블록 노드에는 marks가 올 수 없음)
    if (isBlock && marks !== undefined) {
      errors.push({ path: `${path}/marks`, message: `블록 노드 '${type}'에는 marks가 올 수 없습니다.` });
    }

    if (marks !== undefined) {
      if (!Array.isArray(marks)) {
        errors.push({ path: `${path}/marks`, message: 'marks는 배열이어야 합니다.' });
      } else {
        if (isInsideCodeBlock) {
          errors.push({ path: `${path}/marks`, message: 'codeBlock 내부 텍스트에는 marks를 지정할 수 없습니다.' });
        }
        const seenMarkTypes = new Set();
        for (let m = 0; m < marks.length; m++) {
          const mark = marks[m];
          const markPath = `${path}/marks/${m}`;
          if (!mark || typeof mark !== 'object' || Array.isArray(mark)) {
            errors.push({ path: markPath, message: 'mark는 객체여야 합니다.' });
            continue;
          }
          if (typeof mark.type !== 'string' || !MARK_SET.has(mark.type)) {
            errors.push({ path: `${markPath}/type`, message: `허용되지 않은 마크 타입 '${mark.type}'입니다.` });
            continue;
          }
          if (seenMarkTypes.has(mark.type)) {
            errors.push({ path: markPath, message: `중복된 마크 타입 '${mark.type}'이 있습니다.` });
          }
          seenMarkTypes.add(mark.type);

          // link 마크 검사
          if (mark.type === 'link') {
            if (!mark.attrs || typeof mark.attrs !== 'object' || Array.isArray(mark.attrs)) {
              errors.push({ path: `${markPath}/attrs`, message: "link 마크에는 'attrs' 객체가 필요합니다." });
            } else {
              for (const ak of Object.keys(mark.attrs)) {
                if (!['href', 'title'].includes(ak)) {
                  errors.push({ path: `${markPath}/attrs/${ak}`, message: `link 마크에 허용되지 않은 속성 '${ak}'가 있습니다.` });
                }
              }
              if (!isValidLinkHref(mark.attrs.href)) {
                errors.push({
                  path: `${markPath}/attrs/href`,
                  message: `link.href는 http, https, mailto 스킴의 유효한 URL이어야 합니다. 입력값: '${mark.attrs.href}'`,
                });
              }
              if (mark.attrs.title !== undefined && typeof mark.attrs.title !== 'string') {
                errors.push({ path: `${markPath}/attrs/title`, message: 'link.title은 문자열이어야 합니다.' });
              }
            }
          } else {
            // 다른 마크는 attrs가 없거나 빈 객체여야 함
            if (mark.attrs !== undefined && (typeof mark.attrs !== 'object' || Object.keys(mark.attrs).length > 0)) {
              errors.push({ path: `${markPath}/attrs`, message: `'${mark.type}' 마크에는 attrs를 지정할 수 없습니다.` });
            }
          }
        }
      }
    }

    // 각 노드별 attrs 검사
    validateNodeAttrs(type, attrs, path, errors);

    // text 노드 검사
    if (type === 'text') {
      if (typeof text !== 'string') {
        errors.push({ path: `${path}/text`, message: "text 노드는 'text' 문자열 속성이 필요합니다." });
      } else {
        totalTextLength += text.length;
        if (totalTextLength > maxTextLength) {
          errors.push({
            path: 'doc',
            message: `문서의 총 텍스트 길이(${maxTextLength}자)를 초과했습니다.`,
          });
          return { ok: false, errors };
        }
      }
      if (content !== undefined) {
        errors.push({ path: `${path}/content`, message: 'text 노드는 content를 가질 수 없습니다.' });
      }
      continue;
    }

    // text가 아닌데 text 속성이 있는 경우
    if (text !== undefined) {
      errors.push({ path: `${path}/text`, message: `'${type}' 노드에는 text 속성이 올 수 없습니다.` });
    }

    // 리프 노드 검사
    const isLeaf = [
      'hardBreak',
      'mathInline',
      'mention',
      'noteLink',
      'reagentRef',
      'horizontalRule',
      'image',
      'mathBlock',
    ].includes(type);

    if (isLeaf) {
      if (content !== undefined && (!Array.isArray(content) || content.length > 0)) {
        errors.push({ path: `${path}/content`, message: `'${type}' 노드는 content를 가질 수 없습니다.` });
      }
    } else {
      // 컨테이너 노드 검사
      if (content !== undefined && !Array.isArray(content)) {
        errors.push({ path: `${path}/content`, message: `'${type}' 노드의 content는 배열이어야 합니다.` });
      } else if (Array.isArray(content)) {
        const nextIsInsideCodeBlock = isInsideCodeBlock || type === 'codeBlock';
        for (let i = content.length - 1; i >= 0; i--) {
          stack.push([content[i], `${path}/content/${i}`, depth + 1, type, nextIsInsideCodeBlock]);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * 노드별 attrs 유효성 검사 보조 함수
 * @param {string} type
 * @param {any} attrs
 * @param {string} path
 * @param {import('./types.js').ValidationError[]} errors
 */
function validateNodeAttrs(type, attrs, path, errors) {
  const attrsPath = `${path}/attrs`;

  if (attrs !== undefined && (typeof attrs !== 'object' || attrs === null || Array.isArray(attrs))) {
    errors.push({ path: attrsPath, message: 'attrs는 객체여야 합니다.' });
    return;
  }

  switch (type) {
    case 'paragraph': {
      if (attrs) {
        for (const k of Object.keys(attrs)) {
          if (k === 'align') {
            if (!ALLOWED_ALIGNMENTS.includes(attrs.align)) {
              errors.push({
                path: `${attrsPath}/align`,
                message: `paragraph의 align은 ${ALLOWED_ALIGNMENTS.join(', ')} 중 하나여야 합니다.`,
              });
            }
          } else {
            errors.push({ path: `${attrsPath}/${k}`, message: `paragraph에 허용되지 않은 속성 '${k}'가 있습니다.` });
          }
        }
      }
      break;
    }

    case 'heading': {
      if (!attrs || typeof attrs !== 'object') {
        errors.push({ path: attrsPath, message: "heading에는 'attrs' 객체가 필요합니다." });
        return;
      }
      if (![1, 2, 3].includes(attrs.level)) {
        errors.push({ path: `${attrsPath}/level`, message: 'heading의 level은 1, 2, 3 중 하나여야 합니다.' });
      }
      if (attrs.align !== undefined && !ALLOWED_ALIGNMENTS.includes(attrs.align)) {
        errors.push({
          path: `${attrsPath}/align`,
          message: `heading의 align은 ${ALLOWED_ALIGNMENTS.join(', ')} 중 하나여야 합니다.`,
        });
      }
      for (const k of Object.keys(attrs)) {
        if (!['level', 'align'].includes(k)) {
          errors.push({ path: `${attrsPath}/${k}`, message: `heading에 허용되지 않은 속성 '${k}'가 있습니다.` });
        }
      }
      break;
    }

    case 'orderedList': {
      if (attrs) {
        if (attrs.start !== undefined && (!Number.isInteger(attrs.start) || attrs.start < 1)) {
          errors.push({ path: `${attrsPath}/start`, message: 'orderedList의 start는 1 이상의 정수여야 합니다.' });
        }
        for (const k of Object.keys(attrs)) {
          if (k !== 'start') {
            errors.push({ path: `${attrsPath}/${k}`, message: `orderedList에 허용되지 않은 속성 '${k}'가 있습니다.` });
          }
        }
      }
      break;
    }

    case 'taskItem': {
      if (attrs) {
        if (attrs.checked !== undefined && typeof attrs.checked !== 'boolean') {
          errors.push({ path: `${attrsPath}/checked`, message: 'taskItem의 checked는 boolean이어야 합니다.' });
        }
        for (const k of Object.keys(attrs)) {
          if (k !== 'checked') {
            errors.push({ path: `${attrsPath}/${k}`, message: `taskItem에 허용되지 않은 속성 '${k}'가 있습니다.` });
          }
        }
      }
      break;
    }

    case 'codeBlock': {
      if (attrs) {
        if (attrs.language !== undefined && attrs.language !== null && typeof attrs.language !== 'string') {
          errors.push({ path: `${attrsPath}/language`, message: 'codeBlock의 language는 문자열 또는 null이어야 합니다.' });
        }
        for (const k of Object.keys(attrs)) {
          if (k !== 'language') {
            errors.push({ path: `${attrsPath}/${k}`, message: `codeBlock에 허용되지 않은 속성 '${k}'가 있습니다.` });
          }
        }
      }
      break;
    }

    case 'tableHeader':
    case 'tableCell': {
      if (attrs) {
        if (attrs.colspan !== undefined && (!Number.isInteger(attrs.colspan) || attrs.colspan < 1)) {
          errors.push({ path: `${attrsPath}/colspan`, message: `${type}의 colspan은 1 이상의 정수여야 합니다.` });
        }
        if (attrs.rowspan !== undefined && (!Number.isInteger(attrs.rowspan) || attrs.rowspan < 1)) {
          errors.push({ path: `${attrsPath}/rowspan`, message: `${type}의 rowspan은 1 이상의 정수여야 합니다.` });
        }
        for (const k of Object.keys(attrs)) {
          if (!['colspan', 'rowspan'].includes(k)) {
            errors.push({ path: `${attrsPath}/${k}`, message: `${type}에 허용되지 않은 속성 '${k}'가 있습니다.` });
          }
        }
      }
      break;
    }

    case 'image': {
      if (!attrs || typeof attrs !== 'object') {
        errors.push({ path: attrsPath, message: "image 노드에는 'attrs' 객체가 필요합니다." });
        return;
      }
      if (typeof attrs.attachmentId !== 'string' || !attrs.attachmentId.trim()) {
        errors.push({ path: `${attrsPath}/attachmentId`, message: 'image의 attachmentId는 비어있지 않은 문자열이어야 합니다.' });
      }
      if (attrs.alt !== undefined && typeof attrs.alt !== 'string') {
        errors.push({ path: `${attrsPath}/alt`, message: 'image의 alt는 문자열이어야 합니다.' });
      }
      if (
        attrs.width !== undefined &&
        attrs.width !== null &&
        typeof attrs.width !== 'string' &&
        (typeof attrs.width !== 'number' || Number.isNaN(attrs.width) || attrs.width <= 0)
      ) {
        errors.push({ path: `${attrsPath}/width`, message: 'image의 width는 양수 또는 유효한 문자열이어야 합니다.' });
      }
      for (const k of Object.keys(attrs)) {
        if (!['attachmentId', 'alt', 'width'].includes(k)) {
          errors.push({ path: `${attrsPath}/${k}`, message: `image에 허용되지 않은 속성 '${k}'가 있습니다. (src 속성은 금지됩니다)` });
        }
      }
      break;
    }

    case 'mathBlock':
    case 'mathInline': {
      if (!attrs || typeof attrs !== 'object') {
        errors.push({ path: attrsPath, message: `${type}에는 'attrs' 객체가 필요합니다.` });
        return;
      }
      if (typeof attrs.latex !== 'string') {
        errors.push({ path: `${attrsPath}/latex`, message: `${type}의 latex는 문자열이어야 합니다.` });
      }
      for (const k of Object.keys(attrs)) {
        if (k !== 'latex') {
          errors.push({ path: `${attrsPath}/${k}`, message: `${type}에 허용되지 않은 속성 '${k}'가 있습니다.` });
        }
      }
      break;
    }

    case 'mention': {
      if (!attrs || typeof attrs !== 'object') {
        errors.push({ path: attrsPath, message: "mention에는 'attrs' 객체가 필요합니다." });
        return;
      }
      if (typeof attrs.userId !== 'string' || !attrs.userId.trim()) {
        errors.push({ path: `${attrsPath}/userId`, message: 'mention의 userId는 비어있지 않은 문자열이어야 합니다.' });
      }
      if (typeof attrs.label !== 'string') {
        errors.push({ path: `${attrsPath}/label`, message: 'mention의 label은 문자열이어야 합니다.' });
      }
      for (const k of Object.keys(attrs)) {
        if (!['userId', 'label'].includes(k)) {
          errors.push({ path: `${attrsPath}/${k}`, message: `mention에 허용되지 않은 속성 '${k}'가 있습니다.` });
        }
      }
      break;
    }

    case 'noteLink': {
      if (!attrs || typeof attrs !== 'object') {
        errors.push({ path: attrsPath, message: "noteLink에는 'attrs' 객체가 필요합니다." });
        return;
      }
      if (typeof attrs.noteId !== 'string' || !attrs.noteId.trim()) {
        errors.push({ path: `${attrsPath}/noteId`, message: 'noteLink의 noteId는 비어있지 않은 문자열이어야 합니다.' });
      }
      if (typeof attrs.label !== 'string') {
        errors.push({ path: `${attrsPath}/label`, message: 'noteLink의 label은 문자열이어야 합니다.' });
      }
      for (const k of Object.keys(attrs)) {
        if (!['noteId', 'label'].includes(k)) {
          errors.push({ path: `${attrsPath}/${k}`, message: `noteLink에 허용되지 않은 속성 '${k}'가 있습니다.` });
        }
      }
      break;
    }

    case 'reagentRef': {
      if (!attrs || typeof attrs !== 'object') {
        errors.push({ path: attrsPath, message: "reagentRef에는 'attrs' 객체가 필요합니다." });
        return;
      }
      if (typeof attrs.reagentId !== 'string' || !attrs.reagentId.trim()) {
        errors.push({ path: `${attrsPath}/reagentId`, message: 'reagentRef의 reagentId는 비어있지 않은 문자열이어야 합니다.' });
      }
      if (typeof attrs.label !== 'string') {
        errors.push({ path: `${attrsPath}/label`, message: 'reagentRef의 label은 문자열이어야 합니다.' });
      }
      for (const k of Object.keys(attrs)) {
        if (!['reagentId', 'label'].includes(k)) {
          errors.push({ path: `${attrsPath}/${k}`, message: `reagentRef에 허용되지 않은 속성 '${k}'가 있습니다.` });
        }
      }
      break;
    }

    default: {
      // bulletList, listItem, taskList, blockquote, table, tableRow, horizontalRule, text, hardBreak
      if (attrs && Object.keys(attrs).length > 0) {
        for (const k of Object.keys(attrs)) {
          errors.push({ path: `${attrsPath}/${k}`, message: `'${type}' 노드에는 attrs를 지정할 수 없습니다.` });
        }
      }
      break;
    }
  }
}
