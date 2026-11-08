/**
 * @fileoverview ProseMirror JSON과 note-format 규격 간의 상호 변환 어댑터
 */

import { SCHEMA_VERSION, normalizeDoc } from '@labhub/note-format';

/**
 * ProseMirror JSON 문서를 note-format 문서 규격으로 변환합니다.
 * 최상위 schemaVersion: 1을 추가하고 normalizeDoc을 적용합니다.
 *
 * @param {Record<string, any>} pmJson
 * @returns {Record<string, any>}
 */
export function toNoteDoc(pmJson) {
  if (!pmJson || typeof pmJson !== 'object') {
    return normalizeDoc({
      type: 'doc',
      schemaVersion: SCHEMA_VERSION,
      content: [{ type: 'paragraph' }],
    });
  }

  const rawDoc = {
    type: 'doc',
    schemaVersion: SCHEMA_VERSION,
    content: Array.isArray(pmJson.content) ? pmJson.content : [{ type: 'paragraph' }],
  };

  return normalizeDoc(rawDoc);
}

/**
 * note-format 문서를 TipTap/ProseMirror JSON 문서로 변환합니다.
 * 최상위 schemaVersion을 제거합니다.
 *
 * @param {Record<string, any>} noteDoc
 * @returns {Record<string, any>}
 */
export function fromNoteDoc(noteDoc) {
  if (!noteDoc || typeof noteDoc !== 'object') {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
  }

  const { schemaVersion: _unused, ...pmDoc } = noteDoc;

  return {
    ...pmDoc,
    type: 'doc',
    content: Array.isArray(noteDoc.content) && noteDoc.content.length > 0
      ? noteDoc.content
      : [{ type: 'paragraph' }],
  };
}
