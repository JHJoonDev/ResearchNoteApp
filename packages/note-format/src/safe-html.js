/**
 * @fileoverview 안전한 표시용 HTML 생성 모듈
 */

import { DEFAULT_LIMITS } from './constants.js';
import { isValidLinkHref } from './validate.js';

/**
 * HTML 특수 문자를 안전하게 이스케이프합니다.
 * @param {string | any} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') {
    if (str === null || str === undefined) return '';
    str = String(str);
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 단일 노드 또는 자식들을 HTML로 변환합니다. 깊이 한도를 초과하면 RangeError를 발생시킵니다.
 * @param {import('./types.js').Node} node
 * @param {number} depth
 * @param {number} maxDepth
 * @returns {string}
 */
function nodeToSafeHtml(node, depth, maxDepth) {
  if (!node || typeof node !== 'object') return '';

  if (depth > maxDepth) {
    throw new RangeError(`문서 중첩 깊이 한도(${maxDepth})를 초과했습니다.`);
  }

  const { type, attrs, content, marks, text } = node;

  switch (type) {
    case 'text': {
      let out = escapeHtml(text || '');
      if (Array.isArray(marks) && marks.length > 0) {
        // 일관된 순서로 래핑
        for (const mark of marks) {
          if (!mark || typeof mark !== 'object') continue;
          switch (mark.type) {
            case 'bold':
              out = `<strong>${out}</strong>`;
              break;
            case 'italic':
              out = `<em>${out}</em>`;
              break;
            case 'underline':
              out = `<u>${out}</u>`;
              break;
            case 'strike':
              out = `<s>${out}</s>`;
              break;
            case 'code':
              out = `<code>${out}</code>`;
              break;
            case 'subscript':
              out = `<sub>${out}</sub>`;
              break;
            case 'superscript':
              out = `<sup>${out}</sup>`;
              break;
            case 'link': {
              const href = mark.attrs?.href;
              if (isValidLinkHref(href)) {
                const titleAttr = mark.attrs?.title ? ` title="${escapeHtml(mark.attrs.title)}"` : '';
                out = `<a href="${escapeHtml(href)}"${titleAttr} rel="noopener noreferrer">${out}</a>`;
              }
              break;
            }
          }
        }
      }
      return out;
    }

    case 'hardBreak':
      return '<br>';

    case 'paragraph': {
      const childrenHtml = renderChildren(content, depth, maxDepth);
      const alignStyle = attrs?.align ? ` style="text-align: ${escapeHtml(attrs.align)};"` : '';
      return `<p${alignStyle}>${childrenHtml}</p>`;
    }

    case 'heading': {
      const level = [1, 2, 3].includes(attrs?.level) ? attrs.level : 1;
      const childrenHtml = renderChildren(content, depth, maxDepth);
      const alignStyle = attrs?.align ? ` style="text-align: ${escapeHtml(attrs.align)};"` : '';
      return `<h${level}${alignStyle}>${childrenHtml}</h${level}>`;
    }

    case 'bulletList':
      return `<ul>${renderChildren(content, depth, maxDepth)}</ul>`;

    case 'orderedList': {
      const startAttr = Number.isInteger(attrs?.start) && attrs.start > 1 ? ` start="${attrs.start}"` : '';
      return `<ol${startAttr}>${renderChildren(content, depth, maxDepth)}</ol>`;
    }

    case 'listItem':
      return `<li>${renderChildren(content, depth, maxDepth)}</li>`;

    case 'taskList':
      return `<ul class="task-list">${renderChildren(content, depth, maxDepth)}</ul>`;

    case 'taskItem': {
      const checkedAttr = attrs?.checked ? ' checked' : '';
      const childrenHtml = renderChildren(content, depth, maxDepth);
      return `<li class="task-item"><input type="checkbox" disabled${checkedAttr}>${childrenHtml}</li>`;
    }

    case 'blockquote':
      return `<blockquote>${renderChildren(content, depth, maxDepth)}</blockquote>`;

    case 'codeBlock': {
      const langClass = attrs?.language ? ` class="language-${escapeHtml(attrs.language)}"` : '';
      const rawText = Array.isArray(content)
        ? content.map((c) => (c?.type === 'text' ? c.text || '' : '')).join('')
        : '';
      return `<pre><code${langClass}>${escapeHtml(rawText)}</code></pre>`;
    }

    case 'table':
      return `<table>${renderChildren(content, depth, maxDepth)}</table>`;

    case 'tableRow':
      return `<tr>${renderChildren(content, depth, maxDepth)}</tr>`;

    case 'tableHeader': {
      const colspan = Number.isInteger(attrs?.colspan) && attrs.colspan > 1 ? ` colspan="${attrs.colspan}"` : '';
      const rowspan = Number.isInteger(attrs?.rowspan) && attrs.rowspan > 1 ? ` rowspan="${attrs.rowspan}"` : '';
      return `<th${colspan}${rowspan}>${renderChildren(content, depth, maxDepth)}</th>`;
    }

    case 'tableCell': {
      const colspan = Number.isInteger(attrs?.colspan) && attrs.colspan > 1 ? ` colspan="${attrs.colspan}"` : '';
      const rowspan = Number.isInteger(attrs?.rowspan) && attrs.rowspan > 1 ? ` rowspan="${attrs.rowspan}"` : '';
      return `<td${colspan}${rowspan}>${renderChildren(content, depth, maxDepth)}</td>`;
    }

    case 'horizontalRule':
      return '<hr>';

    case 'image': {
      const attachmentId = escapeHtml(attrs?.attachmentId || '');
      const altAttr = attrs?.alt ? ` alt="${escapeHtml(attrs.alt)}"` : '';
      const widthAttr = attrs?.width ? ` width="${escapeHtml(String(attrs.width))}"` : '';
      return `<img data-attachment-id="${attachmentId}"${altAttr}${widthAttr}>`;
    }

    case 'mathBlock': {
      const latex = escapeHtml(attrs?.latex || '');
      return `<div class="math-block" data-latex="${latex}">${latex}</div>`;
    }

    case 'mathInline': {
      const latex = escapeHtml(attrs?.latex || '');
      return `<span class="math-inline" data-latex="${latex}">${latex}</span>`;
    }

    case 'mention': {
      const userId = escapeHtml(attrs?.userId || '');
      const label = escapeHtml(attrs?.label || '');
      return `<span class="mention" data-user-id="${userId}">@${label}</span>`;
    }

    case 'noteLink': {
      const noteId = escapeHtml(attrs?.noteId || '');
      const label = escapeHtml(attrs?.label || '');
      return `<a class="note-link" data-note-id="${noteId}">${label}</a>`;
    }

    case 'reagentRef': {
      const reagentId = escapeHtml(attrs?.reagentId || '');
      const label = escapeHtml(attrs?.label || '');
      return `<span class="reagent-ref" data-reagent-id="${reagentId}">${label}</span>`;
    }

    case 'doc':
      return renderChildren(content, depth, maxDepth);

    default:
      return renderChildren(content, depth, maxDepth);
  }
}

/**
 * 자식 노드 배열을 HTML 문자열로 렌더링합니다.
 * @param {import('./types.js').Node[]} [content]
 * @param {number} depth
 * @param {number} maxDepth
 * @returns {string}
 */
function renderChildren(content, depth, maxDepth) {
  if (!Array.isArray(content) || content.length === 0) return '';
  return content.map((child) => nodeToSafeHtml(child, depth + 1, maxDepth)).join('');
}

/**
 * 문서를 안전한 표시용 HTML로 변환합니다.
 * - 모든 텍스트와 속성을 이스케이프
 * - image는 <img data-attachment-id>로 내보내고 src는 생성하지 않음
 * 중첩 깊이가 options.maxDepth(기본 32)를 초과하면 RangeError를 발생시킵니다.
 *
 * @param {import('./types.js').Node} doc
 * @param {{ maxDepth?: number }} [options]
 * @returns {string}
 */
export function docToSafeHtml(doc, options = {}) {
  if (!doc || typeof doc !== 'object') return '';
  const maxDepth = Number.isInteger(options?.maxDepth) ? options.maxDepth : DEFAULT_LIMITS.maxDepth;
  return nodeToSafeHtml(doc, 0, maxDepth);
}
