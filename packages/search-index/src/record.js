/**
 * @fileoverview 연구노트 엔티티를 검색 레코드(SearchRecord)로 변환하는 모듈
 */

import { docToPlainText } from '@labhub/note-format';
import { htmlToDoc } from '@labhub/note-format/html';

/**
 * 연구노트 모델 데이터를 검색 인덱싱용 레코드로 변환합니다.
 * 본문이 note-format doc 또는 레거시 HTML 문자열인 경우 평문으로 추출합니다.
 * 변환이 불가능한 손상된 문서라도 결코 예외를 던지지 않고 경고를 남기며 제목과 태그를 색인합니다.
 *
 * @param {any} note 연구노트 객체
 * @returns {import('./types.js').SearchRecord} 검색 레코드
 */
export function noteToRecord(note) {
  if (!note || typeof note !== 'object') {
    return {
      id: '',
      type: 'note',
      title: '',
      text: '',
      tags: [],
      projectId: null,
      authorId: '',
      status: 'draft',
      isDeleted: false,
      updatedAt: new Date().toISOString(),
    };
  }

  let text = '';
  const noteId = String(note.id || note._id || '');

  try {
    if (note.content) {
      if (typeof note.content === 'object' && note.content.type === 'doc') {
        text = docToPlainText(note.content);
      } else if (typeof note.content === 'string') {
        // 레거시 HTML 문자열 변환 시도 (htmlToDoc은 { doc, warnings } 반환)
        try {
          const res = htmlToDoc(note.content);
          const doc = res && res.doc ? res.doc : res;
          text = docToPlainText(doc);
        } catch (htmlErr) {
          console.warn(`[noteToRecord] Failed to convert HTML content for note (${noteId}):`, htmlErr.message);
          text = '';
        }
      }
    }
  } catch (err) {
    console.warn(`[noteToRecord] Inconvertible content for note (${noteId}):`, err.message);
    text = '';
  }

  return {
    id: noteId,
    type: 'note',
    title: typeof note.title === 'string' ? note.title : '',
    text: typeof text === 'string' ? text : '',
    tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
    projectId: note.projectId ? String(note.projectId) : null,
    authorId: note.authorId ? String(note.authorId) : '',
    status: typeof note.status === 'string' ? note.status : 'draft',
    isDeleted: Boolean(note.isDeleted),
    updatedAt: note.updatedAt ? new Date(note.updatedAt).toISOString() : new Date().toISOString(),
  };
}
