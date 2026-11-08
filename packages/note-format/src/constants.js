/**
 * @fileoverview 문서 형식 스키마 정의 및 기본 제한값 상수
 */

export const SCHEMA_VERSION = 1;

export const DEFAULT_LIMITS = Object.freeze({
  maxNodes: 200_000,
  maxDepth: 32,
  maxTextLength: 1_000_000,
});

export const ALLOWED_ALIGNMENTS = Object.freeze(['left', 'center', 'right', 'justify']);

export const ALLOWED_BLOCK_TYPES = Object.freeze([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'horizontalRule',
  'image',
  'mathBlock',
]);

export const ALLOWED_INLINE_TYPES = Object.freeze([
  'text',
  'hardBreak',
  'mathInline',
  'mention',
  'noteLink',
  'reagentRef',
]);

export const ALLOWED_MARK_TYPES = Object.freeze([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'subscript',
  'superscript',
  'link',
]);

export const ALLOWED_LINK_SCHEMES = Object.freeze(['http:', 'https:', 'mailto:']);
