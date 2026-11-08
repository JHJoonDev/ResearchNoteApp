/**
 * @fileoverview 문서 내 외부 참조(첨부파일, 사용자, 노트, 시약) 수집 모듈
 */

import { walkDoc } from './walk.js';

/**
 * 문서에서 참조하는 모든 리소스 식별자를 중복 없이 수집합니다.
 *
 * @param {import('./types.js').Node} doc
 * @returns {import('./types.js').DocReferences}
 */
export function collectReferences(doc) {
  const attachmentIds = new Set();
  const userIds = new Set();
  const noteIds = new Set();
  const reagentIds = new Set();

  walkDoc(doc, (node) => {
    if (!node || typeof node !== 'object') return;

    const { type, attrs } = node;
    if (!attrs) return;

    switch (type) {
      case 'image':
        if (typeof attrs.attachmentId === 'string' && attrs.attachmentId.trim()) {
          attachmentIds.add(attrs.attachmentId.trim());
        }
        break;

      case 'mention':
        if (typeof attrs.userId === 'string' && attrs.userId.trim()) {
          userIds.add(attrs.userId.trim());
        }
        break;

      case 'noteLink':
        if (typeof attrs.noteId === 'string' && attrs.noteId.trim()) {
          noteIds.add(attrs.noteId.trim());
        }
        break;

      case 'reagentRef':
        if (typeof attrs.reagentId === 'string' && attrs.reagentId.trim()) {
          reagentIds.add(attrs.reagentId.trim());
        }
        break;
    }
  });

  return {
    attachmentIds: Array.from(attachmentIds),
    userIds: Array.from(userIds),
    noteIds: Array.from(noteIds),
    reagentIds: Array.from(reagentIds),
  };
}
