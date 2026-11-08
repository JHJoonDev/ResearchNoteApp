/**
 * @fileoverview TipTap 에디터 확장 목록 생성 (note-format 스키마와 100% 일치)
 */

import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Heading } from '@tiptap/extension-heading';
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { ListItem } from '@tiptap/extension-list-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Blockquote } from '@tiptap/extension-blockquote';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Bold } from '@tiptap/extension-bold';
import { Italic } from '@tiptap/extension-italic';
import { Underline } from '@tiptap/extension-underline';
import { Strike } from '@tiptap/extension-strike';
import { Code } from '@tiptap/extension-code';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Link } from '@tiptap/extension-link';
import { History } from '@tiptap/extension-history';

import { ImageExtension } from './image.js';
import { MathBlock, MathInline } from './math.js';
import { Mention, NoteLink, ReagentRef } from './atoms.js';
import {
  MentionSuggestion,
  NoteLinkSuggestion,
  ReagentRefSuggestion,
  mentionSuggestionPluginKey,
  noteLinkSuggestionPluginKey,
  reagentRefSuggestionPluginKey,
} from './suggestions.js';

export {
  MentionSuggestion,
  NoteLinkSuggestion,
  ReagentRefSuggestion,
  mentionSuggestionPluginKey,
  noteLinkSuggestionPluginKey,
  reagentRefSuggestionPluginKey,
};

export const CustomParagraph = Paragraph.extend({
  addAttributes() {
    return {
      align: {
        default: null,
        parseHTML: (element) => {
          const style = element.style?.textAlign;
          if (['left', 'center', 'right', 'justify'].includes(style)) return style;
          for (const c of element.classList || []) {
            if (c === 'ql-align-center') return 'center';
            if (c === 'ql-align-right') return 'right';
            if (c === 'ql-align-justify') return 'justify';
            if (c === 'ql-align-left') return 'left';
          }
          return null;
        },
        renderHTML: (attributes) => {
          if (!attributes.align) return {};
          return { style: `text-align: ${attributes.align}` };
        },
      },
    };
  },
});

export const CustomHeading = Heading.extend({
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element) => {
          const level = parseInt(element.tagName.replace('H', ''), 10);
          return [1, 2, 3].includes(level) ? level : 1;
        },
        renderHTML: (attributes) => ({}),
      },
      align: {
        default: null,
        parseHTML: (element) => {
          const style = element.style?.textAlign;
          if (['left', 'center', 'right', 'justify'].includes(style)) return style;
          for (const c of element.classList || []) {
            if (c === 'ql-align-center') return 'center';
            if (c === 'ql-align-right') return 'right';
            if (c === 'ql-align-justify') return 'justify';
            if (c === 'ql-align-left') return 'left';
          }
          return null;
        },
        renderHTML: (attributes) => {
          if (!attributes.align) return {};
          return { style: `text-align: ${attributes.align}` };
        },
      },
    };
  },
});

export const CustomOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => {
          return element.hasAttribute('start')
            ? parseInt(element.getAttribute('start') || '1', 10)
            : 1;
        },
        renderHTML: (attributes) => {
          return attributes.start > 1 ? { start: attributes.start } : {};
        },
      },
    };
  },
});

export const CustomTaskItem = TaskItem.extend({
  // note-format에는 nested 속성이 없으므로 checked만 허용
  addAttributes() {
    return {
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element) => {
          const input = element.querySelector('input[type="checkbox"]');
          return input ? input.checked : element.getAttribute('data-checked') === 'true';
        },
        renderHTML: (attributes) => ({
          'data-checked': attributes.checked,
        }),
      },
    };
  },
});

export const CustomTableHeader = TableHeader.extend({
  // note-format에는 colwidth 속성이 없으므로 colspan, rowspan만 허용
  addAttributes() {
    return {
      colspan: {
        default: 1,
        parseHTML: (element) => parseInt(element.getAttribute('colspan') || '1', 10),
        renderHTML: (attributes) => (attributes.colspan > 1 ? { colspan: attributes.colspan } : {}),
      },
      rowspan: {
        default: 1,
        parseHTML: (element) => parseInt(element.getAttribute('rowspan') || '1', 10),
        renderHTML: (attributes) => (attributes.rowspan > 1 ? { rowspan: attributes.rowspan } : {}),
      },
    };
  },
});

export const CustomTableCell = TableCell.extend({
  // note-format에는 colwidth 속성이 없으므로 colspan, rowspan만 허용
  addAttributes() {
    return {
      colspan: {
        default: 1,
        parseHTML: (element) => parseInt(element.getAttribute('colspan') || '1', 10),
        renderHTML: (attributes) => (attributes.colspan > 1 ? { colspan: attributes.colspan } : {}),
      },
      rowspan: {
        default: 1,
        parseHTML: (element) => parseInt(element.getAttribute('rowspan') || '1', 10),
        renderHTML: (attributes) => (attributes.rowspan > 1 ? { rowspan: attributes.rowspan } : {}),
      },
    };
  },
});

export const CustomLink = Link.extend({
  // note-format에는 target, rel, class가 없으므로 href, title만 허용
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) => {
          const href = element.getAttribute('href');
          return isValidEditorLinkHref(href) ? href : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.href || !isValidEditorLinkHref(attributes.href)) return {};
          return { href: attributes.href, rel: 'noopener noreferrer' };
        },
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('title') || null,
        renderHTML: (attributes) => (attributes.title ? { title: attributes.title } : {}),
      },
    };
  },
});

export function isValidEditorLinkHref(href) {
  if (typeof href !== 'string' || !href.trim()) return false;
  const trimmed = href.trim();
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return false;
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed);
}

/**
 * 에디터 확장 목록을 생성합니다.
 * @param {Object} [options]
 * @param {Function} [options.onUploadImage]
 * @param {Function} [options.resolveImageUrl]
 * @param {Function} [options.searchMentions]
 * @param {Function} [options.searchNotes]
 * @param {Function} [options.searchReagents]
 * @param {Function} [options.suggestionRender]
 * @returns {Array}
 */
export function createExtensions(options = {}) {
  return [
    // 1. 핵심 구조
    Document,
    CustomParagraph,
    Text,
    CustomHeading.configure({ levels: [1, 2, 3] }),

    // 2. 블록 노드
    BulletList,
    CustomOrderedList,
    ListItem,
    TaskList,
    CustomTaskItem,
    Blockquote,
    CodeBlock,
    Table.configure({ resizable: false }),
    TableRow,
    CustomTableHeader,
    CustomTableCell,
    HorizontalRule,

    // 3. 커스텀 블록 노드
    ImageExtension.configure({
      onUploadImage: options.onUploadImage,
      resolveImageUrl: options.resolveImageUrl,
      onUploadError: options.onUploadError,
    }),
    MathBlock,

    // 4. 인라인 노드
    HardBreak,
    MathInline,
    Mention,
    NoteLink,
    ReagentRef,

    // 5. 마크 (8종)
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    Subscript,
    Superscript,
    CustomLink.configure({
      openOnClick: false,
      validate: isValidEditorLinkHref,
    }),

    // 6. 히스토리 (Undo / Redo)
    History,

    // 7. 자동완성 제안 (Suggestion)
    MentionSuggestion.configure({
      searchMentions: options.searchMentions,
      suggestionRender: options.suggestionRender,
    }),
    NoteLinkSuggestion.configure({
      searchNotes: options.searchNotes,
      suggestionRender: options.suggestionRender,
    }),
    ReagentRefSuggestion.configure({
      searchReagents: options.searchReagents,
      suggestionRender: options.suggestionRender,
    }),
  ];
}
