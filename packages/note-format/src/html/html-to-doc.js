/**
 * @fileoverview HTML(Quill HTML 등)을 ProseMirror JSON 문서로 변환하는 모듈
 */

import { parseFragment } from 'parse5';
import { SCHEMA_VERSION } from '../constants.js';
import { validateDoc, isValidLinkHref } from '../validate.js';
import { normalizeDoc } from '../normalize.js';

/**
 * node에서 특정 속성 값을 가져옵니다.
 * @param {any} node
 * @param {string} attrName
 * @returns {string | null}
 */
function getAttr(node, attrName) {
  if (!node || !Array.isArray(node.attrs)) return null;
  const found = node.attrs.find((a) => a.name.toLowerCase() === attrName.toLowerCase());
  return found ? found.value : null;
}

/**
 * node의 클래스명 배열을 가져옵니다.
 * @param {any} node
 * @returns {string[]}
 */
function getClasses(node) {
  const cls = getAttr(node, 'class');
  return cls ? cls.split(/\s+/).filter(Boolean) : [];
}

/**
 * node에서 텍스트 정렬 속성을 추출합니다.
 * @param {any} node
 * @returns {'left' | 'center' | 'right' | 'justify' | undefined}
 */
function extractAlignment(node) {
  const classes = getClasses(node);
  for (const c of classes) {
    if (c === 'ql-align-center') return 'center';
    if (c === 'ql-align-right') return 'right';
    if (c === 'ql-align-justify') return 'justify';
    if (c === 'ql-align-left') return 'left';
  }
  const style = getAttr(node, 'style');
  if (style) {
    const match = style.match(/text-align\s*:\s*(center|right|justify|left)/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return undefined;
}

/**
 * Quill indent 레벨을 가져옵니다 (0 ~ 8).
 * @param {any} node
 * @returns {number}
 */
function extractIndent(node) {
  const classes = getClasses(node);
  for (const c of classes) {
    const m = c.match(/^ql-indent-(\d+)$/);
    if (m) {
      return parseInt(m[1], 10);
    }
  }
  return 0;
}

/**
 * HTML 문자열을 ProseMirror 호환 JSON 문서로 변환합니다.
 *
 * @param {string} html
 * @returns {{ doc: import('../types.js').Node, warnings: string[] }}
 */
export function htmlToDoc(html) {
  const warnings = [];

  if (typeof html !== 'string' || !html.trim()) {
    const emptyDoc = {
      type: 'doc',
      schemaVersion: SCHEMA_VERSION,
      content: [{ type: 'paragraph' }],
    };
    return { doc: emptyDoc, warnings };
  }

  const fragment = parseFragment(html);
  const blocks = [];

  // 파스 트리를 블록 단위로 순회하여 변환
  convertNodesToBlocks(fragment.childNodes, blocks, warnings);

  // 최상위 블록이 비어있으면 기본 paragraph 1개 제공
  if (blocks.length === 0) {
    blocks.push({ type: 'paragraph' });
  }

  let doc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: blocks,
  };

  doc = normalizeDoc(doc);

  const validation = validateDoc(doc);
  if (!validation.ok) {
    for (const err of validation.errors) {
      warnings.push(`문서 구조 유효성 경고: [${err.path}] ${err.message}`);
    }
  }

  return { doc, warnings };
}

/**
 * 자식 파스 노드들을 순회하며 최상위 블록 목록으로 변환합니다.
 * 인라인 노드들이 최상위에 단독으로 나타나면 paragraph로 감쌉니다.
 *
 * @param {any[]} nodes
 * @param {any[]} targetBlocks
 * @param {string[]} warnings
 */
function convertNodesToBlocks(nodes, targetBlocks, warnings) {
  if (!Array.isArray(nodes)) return;

  let pendingInlines = [];

  const flushInlines = () => {
    if (pendingInlines.length > 0) {
      const hasMeaningfulContent = pendingInlines.some(
        (inl) =>
          inl.type !== 'text' ||
          (inl.text && inl.text.trim().length > 0) ||
          (Array.isArray(inl.marks) && inl.marks.length > 0),
      );
      if (hasMeaningfulContent) {
        targetBlocks.push({
          type: 'paragraph',
          content: pendingInlines,
        });
      }
      pendingInlines = [];
    }
  };

  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    const nodeName = node.nodeName.toLowerCase();

    // 텍스트 노드
    if (nodeName === '#text') {
      const text = node.value;
      if (text) {
        // 블록 컨텍스트에서 아직 대기 중인 인라인이 없고 공백만 있으면 건너뜀
        if (pendingInlines.length === 0 && !text.trim()) {
          i++;
          continue;
        }
        pendingInlines.push({ type: 'text', text });
      }
      i++;
      continue;
    }

    // 주석 노드 무시
    if (nodeName === '#comment') {
      i++;
      continue;
    }

    // 목록 태그 (ul, ol) 또는 data-list를 포함하는 li들의 연속
    if (nodeName === 'ul' || nodeName === 'ol' || (nodeName === 'li' && getAttr(node, 'data-list'))) {
      flushInlines();
      const listResult = processListCluster(nodes, i, warnings);
      if (listResult.blocks.length > 0) {
        targetBlocks.push(...listResult.blocks);
      }
      i = listResult.nextIndex;
      continue;
    }

    // 블록 레벨 요소 처리
    if (nodeName === 'p') {
      flushInlines();
      const inlines = [];
      collectInlines(node.childNodes, inlines, [], warnings);
      const align = extractAlignment(node);
      const pBlock = { type: 'paragraph' };
      if (align) pBlock.attrs = { align };
      if (inlines.length > 0) pBlock.content = inlines;
      targetBlocks.push(pBlock);
      i++;
      continue;
    }

    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(nodeName)) {
      flushInlines();
      const inlines = [];
      collectInlines(node.childNodes, inlines, [], warnings);
      let level = parseInt(nodeName.slice(1), 10);
      if (level > 3) {
        warnings.push(`헤딩 레벨 h${level}은 h3으로 변환되었습니다.`);
        level = 3;
      }
      const align = extractAlignment(node);
      const hBlock = {
        type: 'heading',
        attrs: { level, ...(align ? { align } : {}) },
      };
      if (inlines.length > 0) hBlock.content = inlines;
      targetBlocks.push(hBlock);
      i++;
      continue;
    }

    if (nodeName === 'blockquote') {
      flushInlines();
      const childBlocks = [];
      convertNodesToBlocks(node.childNodes, childBlocks, warnings);
      targetBlocks.push({
        type: 'blockquote',
        content: childBlocks.length > 0 ? childBlocks : [{ type: 'paragraph' }],
      });
      i++;
      continue;
    }

    if (nodeName === 'pre') {
      flushInlines();
      const rawText = collectAllText(node);
      const classes = getClasses(node);
      let language = null;
      for (const c of classes) {
        if (c.startsWith('language-')) {
          language = c.slice('language-'.length);
          break;
        }
      }
      const codeBlock = {
        type: 'codeBlock',
        attrs: { language },
        content: rawText ? [{ type: 'text', text: rawText }] : [],
      };
      targetBlocks.push(codeBlock);
      i++;
      continue;
    }

    if (nodeName === 'table') {
      flushInlines();
      const tableBlock = convertTable(node, warnings);
      if (tableBlock) {
        targetBlocks.push(tableBlock);
      }
      i++;
      continue;
    }

    if (nodeName === 'hr') {
      flushInlines();
      targetBlocks.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // div, section, article 등 범용 컨테이너
    if (['div', 'section', 'article', 'main', 'header', 'footer'].includes(nodeName)) {
      flushInlines();
      const childBlocks = [];
      convertNodesToBlocks(node.childNodes, childBlocks, warnings);
      if (childBlocks.length > 0) {
        targetBlocks.push(...childBlocks);
      }
      i++;
      continue;
    }

    // image 태그가 블록으로 나타난 경우
    if (nodeName === 'img') {
      flushInlines();
      const imgBlock = convertImage(node, warnings);
      if (imgBlock) {
        targetBlocks.push(imgBlock);
      }
      i++;
      continue;
    }

    // 기타 인라인 요소이거나 알 수 없는 태그
    // 인라인으로 처리 가능하면 pendingInlines에 추가
    const isKnownInline = ['span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'a', 'br', 'sub', 'sup'].includes(nodeName);
    if (isKnownInline) {
      collectInlines([node], pendingInlines, [], warnings);
    } else {
      // 알 수 없는 태그: 내용을 잃지 않고 인라인으로 보존
      warnings.push(`알 수 없는 태그 <${nodeName}>의 텍스트 내용을 보존했습니다.`);
      collectInlines(node.childNodes, pendingInlines, [], warnings);
    }

    i++;
  }

  flushInlines();
}

/**
 * table 파스 노드를 table 블록으로 변환합니다.
 * @param {any} node
 * @param {string[]} warnings
 * @returns {any}
 */
function convertTable(node, warnings) {
  const rows = [];

  const visit = (curr) => {
    if (!curr || !Array.isArray(curr.childNodes)) return;
    for (const child of curr.childNodes) {
      const name = child.nodeName.toLowerCase();
      if (name === 'tr') {
        const cells = [];
        for (const cellNode of child.childNodes || []) {
          const cName = cellNode.nodeName.toLowerCase();
          if (cName === 'th' || cName === 'td') {
            const cellType = cName === 'th' ? 'tableHeader' : 'tableCell';
            const cellAttrs = {};
            const colspan = parseInt(getAttr(cellNode, 'colspan') || '1', 10);
            const rowspan = parseInt(getAttr(cellNode, 'rowspan') || '1', 10);
            if (colspan > 1) cellAttrs.colspan = colspan;
            if (rowspan > 1) cellAttrs.rowspan = rowspan;

            const cellBlocks = [];
            convertNodesToBlocks(cellNode.childNodes, cellBlocks, warnings);
            if (cellBlocks.length === 0) {
              cellBlocks.push({ type: 'paragraph' });
            }

            const cell = { type: cellType, content: cellBlocks };
            if (Object.keys(cellAttrs).length > 0) {
              cell.attrs = cellAttrs;
            }
            cells.push(cell);
          }
        }
        if (cells.length > 0) {
          rows.push({ type: 'tableRow', content: cells });
        }
      } else if (['thead', 'tbody', 'tfoot'].includes(name)) {
        visit(child);
      }
    }
  };

  visit(node);

  if (rows.length === 0) {
    // 빈 테이블인 경우 빈 셀 1개 행 생성
    rows.push({
      type: 'tableRow',
      content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }],
    });
  }

  return { type: 'table', content: rows };
}

/**
 * img 파스 노드를 image 블록으로 변환합니다.
 * @param {any} node
 * @param {string[]} warnings
 * @returns {any}
 */
function convertImage(node, warnings) {
  const attachmentId =
    getAttr(node, 'data-attachment-id') ||
    getAttr(node, 'data-id') ||
    getAttr(node, 'src');

  if (!attachmentId) {
    warnings.push('attachmentId 또는 src가 없는 img 태그는 무시되었습니다.');
    return null;
  }

  const alt = getAttr(node, 'alt') || '';
  const width = getAttr(node, 'width');

  const attrs = { attachmentId, alt };
  if (width) {
    attrs.width = width;
  }

  return { type: 'image', attrs };
}

/**
 * 인라인 파스 노드들을 재귀적으로 순회하여 TipTap 인라인 노드 목록을 구축합니다.
 *
 * @param {any[]} nodes
 * @param {any[]} inlines
 * @param {any[]} currentMarks
 * @param {string[]} warnings
 */
function collectInlines(nodes, inlines, currentMarks, warnings) {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    const nodeName = node.nodeName.toLowerCase();

    if (nodeName === '#text') {
      const text = node.value;
      if (text) {
        const textNode = { type: 'text', text };
        if (currentMarks.length > 0) {
          textNode.marks = [...currentMarks];
        }
        inlines.push(textNode);
      }
      continue;
    }

    if (nodeName === '#comment') {
      continue;
    }

    if (nodeName === 'br') {
      inlines.push({ type: 'hardBreak' });
      continue;
    }

    // 특수 인라인 노드 (data-user-id, data-note-id, data-reagent-id, data-latex 등)
    if (nodeName === 'span') {
      const userId = getAttr(node, 'data-user-id');
      if (userId) {
        const label = collectAllText(node).replace(/^@/, '') || '사용자';
        inlines.push({ type: 'mention', attrs: { userId, label } });
        continue;
      }
      const noteId = getAttr(node, 'data-note-id');
      if (noteId) {
        const label = collectAllText(node) || '노트';
        inlines.push({ type: 'noteLink', attrs: { noteId, label } });
        continue;
      }
      const reagentId = getAttr(node, 'data-reagent-id');
      if (reagentId) {
        const label = collectAllText(node) || '시약';
        inlines.push({ type: 'reagentRef', attrs: { reagentId, label } });
        continue;
      }
      const latex = getAttr(node, 'data-latex');
      if (latex) {
        inlines.push({ type: 'mathInline', attrs: { latex } });
        continue;
      }
    }

    // 마크 매핑
    let newMark = null;

    if (nodeName === 'strong' || nodeName === 'b') {
      newMark = { type: 'bold' };
    } else if (nodeName === 'em' || nodeName === 'i') {
      newMark = { type: 'italic' };
    } else if (nodeName === 'u') {
      newMark = { type: 'underline' };
    } else if (nodeName === 's' || nodeName === 'del' || nodeName === 'strike') {
      newMark = { type: 'strike' };
    } else if (nodeName === 'code') {
      newMark = { type: 'code' };
    } else if (nodeName === 'sub') {
      newMark = { type: 'subscript' };
    } else if (nodeName === 'sup') {
      newMark = { type: 'superscript' };
    } else if (nodeName === 'a') {
      const href = getAttr(node, 'href');
      if (isValidLinkHref(href)) {
        const title = getAttr(node, 'title');
        const attrs = { href };
        if (title) attrs.title = title;
        newMark = { type: 'link', attrs };
      } else {
        warnings.push(`지원되지 않거나 안전하지 않은 링크 URL '${href}'의 링크 마크를 제거했습니다.`);
      }
    }

    const nextMarks = newMark ? addMark(currentMarks, newMark) : currentMarks;
    collectInlines(node.childNodes, inlines, nextMarks, warnings);
  }
}

/**
 * 마크 목록에 중복 없이 마크를 추가합니다.
 * @param {any[]} marks
 * @param {any} mark
 * @returns {any[]}
 */
function addMark(marks, mark) {
  if (marks.some((m) => m.type === mark.type)) {
    return marks;
  }
  return [...marks, mark];
}

/**
 * 노드 트리의 모든 순수 텍스트를 추출합니다.
 * @param {any} node
 * @returns {string}
 */
function collectAllText(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value || '';
  if (!Array.isArray(node.childNodes)) return '';
  return node.childNodes.map((c) => collectAllText(c)).join('');
}

/**
 * Quill 목록 클러스터를 복원합니다.
 * Quill 1 평면 `<li data-list="..." class="ql-indent-N">` 및
 * Quill 2 semantic `<ul><li>...<ul>...</ul></li></ul>` 혼합을 중첩 구조로 변환합니다.
 *
 * @param {any[]} nodes
 * @param {number} startIndex
 * @param {string[]} warnings
 * @returns {{ blocks: any[], nextIndex: number }}
 */
function processListCluster(nodes, startIndex, warnings) {
  // 연속된 ul, ol 또는 data-list가 있는 li를 모두 수집하여 평탄화된 목록 아이템 리스트로 만듦
  const items = [];
  let currIdx = startIndex;

  while (currIdx < nodes.length) {
    const node = nodes[currIdx];
    const nodeName = node.nodeName.toLowerCase();

    if (nodeName === 'ul' || nodeName === 'ol') {
      const defaultListType = nodeName === 'ol' ? 'orderedList' : 'bulletList';
      extractListItems(node, defaultListType, 0, items, warnings);
      currIdx++;
    } else if (nodeName === 'li' && getAttr(node, 'data-list')) {
      const dataList = getAttr(node, 'data-list');
      const listType = dataList === 'ordered' ? 'orderedList' : 'bulletList';
      const indent = extractIndent(node);
      const inlines = [];
      collectInlines(node.childNodes, inlines, [], warnings);
      items.push({
        listType,
        indent,
        inlines,
      });
      currIdx++;
    } else {
      break;
    }
  }

  const blocks = buildNestedList(items);
  return { blocks, nextIndex: currIdx };
}

/**
 * ul 또는 ol 노드 내부의 li들을 재귀적으로 추출합니다 (Quill 2 semantic HTML 지원).
 * @param {any} listElement
 * @param {'bulletList' | 'orderedList'} parentListType
 * @param {number} baseIndent
 * @param {any[]} targetItems
 * @param {string[]} warnings
 */
function extractListItems(listElement, parentListType, baseIndent, targetItems, warnings) {
  if (!listElement || !Array.isArray(listElement.childNodes)) return;

  for (const child of listElement.childNodes) {
    const cName = child.nodeName.toLowerCase();
    if (cName === 'li') {
      const dataList = getAttr(child, 'data-list');
      const listType = dataList
        ? dataList === 'ordered'
          ? 'orderedList'
          : 'bulletList'
        : parentListType;
      const explicitIndent = extractIndent(child);
      const totalIndent = baseIndent + explicitIndent;

      const inlines = [];
      const nestedLists = [];

      // li 자식 중 중첩 ul/ol 분리
      for (const liChild of child.childNodes || []) {
        const lcName = liChild.nodeName.toLowerCase();
        if (lcName === 'ul' || lcName === 'ol') {
          nestedLists.push(liChild);
        } else {
          collectInlines([liChild], inlines, [], warnings);
        }
      }

      targetItems.push({
        listType,
        indent: totalIndent,
        inlines,
      });

      // 중첩 목록 재귀 처리
      for (const nested of nestedLists) {
        const nestedType = nested.nodeName.toLowerCase() === 'ol' ? 'orderedList' : 'bulletList';
        extractListItems(nested, nestedType, totalIndent + 1, targetItems, warnings);
      }
    } else if (cName === 'ul' || cName === 'ol') {
      const nestedType = cName === 'ol' ? 'orderedList' : 'bulletList';
      extractListItems(child, nestedType, baseIndent + 1, targetItems, warnings);
    }
  }
}

/**
 * 평탄화된 목록 아이템 리스트를 올바른 중첩 bulletList / orderedList 트리로 빌드합니다.
 * @param {Array<{ listType: string, indent: number, inlines: any[] }>} items
 * @returns {any[]}
 */
function buildNestedList(items) {
  if (items.length === 0) return [];

  // rootLists: 최상위 목록 노드들
  const rootLists = [];

  // stack of { listType, indent, listNode, currentItemNode }
  const stack = [];

  for (const item of items) {
    const itemBlock = {
      type: 'paragraph',
      content: item.inlines.length > 0 ? item.inlines : undefined,
    };
    const listItemNode = {
      type: 'listItem',
      content: [itemBlock],
    };

    // 스택에서 현재 indent보다 깊은 레벨은 pop
    while (stack.length > 0 && stack[stack.length - 1].indent > item.indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      // 최상위 새 목록 생성
      const newList = {
        type: item.listType,
        content: [listItemNode],
      };
      rootLists.push(newList);
      stack.push({
        listType: item.listType,
        indent: item.indent,
        listNode: newList,
        currentItemNode: listItemNode,
      });
      continue;
    }

    const top = stack[stack.length - 1];

    if (item.indent === top.indent) {
      if (item.listType === top.listType) {
        top.listNode.content.push(listItemNode);
        top.currentItemNode = listItemNode;
      } else {
        // 동일 레벨이지만 bullet <-> ordered 변경
        stack.pop();
        const newList = {
          type: item.listType,
          content: [listItemNode],
        };
        if (stack.length === 0) {
          rootLists.push(newList);
        } else {
          stack[stack.length - 1].currentItemNode.content.push(newList);
        }
        stack.push({
          listType: item.listType,
          indent: item.indent,
          listNode: newList,
          currentItemNode: listItemNode,
        });
      }
    } else {
      // item.indent > top.indent (하위 들여쓰기)
      const newList = {
        type: item.listType,
        content: [listItemNode],
      };
      top.currentItemNode.content.push(newList);
      stack.push({
        listType: item.listType,
        indent: item.indent,
        listNode: newList,
        currentItemNode: listItemNode,
      });
    }
  }

  return rootLists;
}
