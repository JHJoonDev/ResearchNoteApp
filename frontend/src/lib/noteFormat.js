import { SCHEMA_VERSION, docToPlainText, diffDocs, normalizeDoc } from '@labhub/note-format';
import { htmlToDoc } from '@labhub/note-format/html';

export const emptyNoteDoc = () => ({
  type: 'doc',
  schemaVersion: SCHEMA_VERSION,
  content: [{ type: 'paragraph' }],
});

export function stripUnsetDocAttributes(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(stripUnsetDocAttributes);

  const cleaned = { ...node };
  if (cleaned.attrs && typeof cleaned.attrs === 'object' && !Array.isArray(cleaned.attrs)) {
    const attrs = Object.fromEntries(
      Object.entries(cleaned.attrs).filter(([, value]) => value !== null),
    );
    if (Object.keys(attrs).length) cleaned.attrs = attrs;
    else delete cleaned.attrs;
  }
  if (Array.isArray(cleaned.content)) {
    cleaned.content = cleaned.content.map(stripUnsetDocAttributes);
  }
  return cleaned;
}

export function noteDoc(note) {
  if (note?.contentDoc?.type === 'doc') return normalizeDoc(note.contentDoc);
  if (note?.content?.type === 'doc') return normalizeDoc(note.content);
  return htmlToDoc(typeof note?.content === 'string' ? note.content : '').doc;
}

export function draftDoc(draft) {
  if (draft?.contentDoc?.type === 'doc') return normalizeDoc(draft.contentDoc);
  if (draft?.content?.type === 'doc') return normalizeDoc(draft.content);
  return htmlToDoc(typeof draft?.content === 'string' ? draft.content : '').doc;
}

export { docToPlainText, diffDocs, normalizeDoc };
