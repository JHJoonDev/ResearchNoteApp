import { collectReferences, docToPlainText, docToSafeHtml, normalizeDoc, validateDoc, walkDoc } from '@labhub/note-format';
import { htmlToDoc } from '@labhub/note-format/html';
import { fail, cleanContent } from './core.js';
import { canonicalize } from './canonical.js';

// Leave room for rendered HTML, audit metadata and version fields in BSON rows.
export const MAX_CONTENT_DOC_BYTES = 768 * 1024;

export function validateAndNormalizeDoc(value) {
  try {
    if (Buffer.byteLength(canonicalize(value), 'utf8') > MAX_CONTENT_DOC_BYTES)
      fail(413, '문서 본문이 허용된 크기(768KB)를 초과했습니다.');
    const result = validateDoc(value);
    if (!result.ok) throw Object.assign(new Error('문서 형식이 올바르지 않습니다.'), { status: 400, details: { errors: result.errors } });
    const normalized = normalizeDoc(value);
    if (Buffer.byteLength(canonicalize(normalized), 'utf8') > MAX_CONTENT_DOC_BYTES)
      fail(413, '문서 본문이 허용된 크기(768KB)를 초과했습니다.');
    return normalized;
  } catch (error) {
    if (error.status === 413) throw error;
    fail(400, error.message || '문서 형식이 올바르지 않습니다.', error.details);
  }
}

export function parseWriteContent(body, previous = null) {
  if (Object.hasOwn(body, 'contentDoc')) {
    const contentDoc = validateAndNormalizeDoc(body.contentDoc);
    return { contentFormat: 'doc', contentDoc, content: docToSafeHtml(contentDoc) };
  }
  if (Object.hasOwn(body, 'content')) {
    if (process.env.ALLOW_LEGACY_ELN_WRITES !== 'true') fail(400, '새 노트는 문서 형식으로 저장해야 합니다.');
    const html = cleanContent(String(body.content ?? ''));
    return { contentFormat: 'html', content: html, contentDoc: undefined };
  }
  if (previous) return { contentFormat: previous.contentFormat || 'html', content: previous.content, contentDoc: previous.contentDoc };
  return { contentFormat: 'html', content: '', contentDoc: undefined };
}

export function readContent(note) {
  if ((note.contentFormat || 'html') === 'doc' && note.contentDoc) {
    return { contentFormat: 'doc', contentDoc: note.contentDoc, conversionWarnings: [] };
  }
  const { doc, warnings } = htmlToDoc(note.content || '');
  return { contentFormat: 'html', contentDoc: doc, conversionWarnings: warnings };
}

export function hasDocumentContent(doc) {
  if (docToPlainText(doc).trim()) return true;
  let nonText = false;
  walkDoc(doc, (node) => {
    if (['image', 'table', 'mathBlock', 'mathInline'].includes(node?.type)) nonText = true;
  });
  return nonText;
}

export function references(doc) {
  return collectReferences(doc);
}
