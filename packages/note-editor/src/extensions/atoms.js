/**
 * @fileoverview 인라인 아톰 노드 확장: mention, noteLink, reagentRef
 */

import { Node, mergeAttributes } from '@tiptap/core';

export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      userId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-user-id') || '',
        renderHTML: (attrs) => ({ 'data-user-id': attrs.userId }),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || el.textContent.replace(/^@/, '') || '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-user-id]',
        getAttrs: (dom) => ({
          userId: dom.getAttribute('data-user-id') || '',
          label: dom.getAttribute('data-label') || dom.textContent.replace(/^@/, '') || '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ class: 'mention' }, HTMLAttributes),
      `@${node.attrs.label || '사용자'}`,
    ];
  },
});

export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      noteId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-note-id') || '',
        renderHTML: (attrs) => ({ 'data-note-id': attrs.noteId }),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-note-id]',
        getAttrs: (dom) => ({
          noteId: dom.getAttribute('data-note-id') || '',
          label: dom.getAttribute('data-label') || dom.textContent || '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes({ class: 'note-link' }, HTMLAttributes),
      node.attrs.label || '노트',
    ];
  },
});

export const ReagentRef = Node.create({
  name: 'reagentRef',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      reagentId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-reagent-id') || '',
        renderHTML: (attrs) => ({ 'data-reagent-id': attrs.reagentId }),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-reagent-id]',
        getAttrs: (dom) => ({
          reagentId: dom.getAttribute('data-reagent-id') || '',
          label: dom.getAttribute('data-label') || dom.textContent || '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ class: 'reagent-ref' }, HTMLAttributes),
      node.attrs.label || '시약',
    ];
  },
});
