import mongoose from 'mongoose';
import sanitizeHtml from 'sanitize-html';
import Project from '../models/Project.js';
import ElnNote from '../models/ElnNote.js';
import { audit } from './audit.js';
export function fail(status, message, details = undefined) {
  throw Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}
export function text(value, name, max = 200, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(400, `${name} 값을 확인해주세요.`);
  return value.trim();
}
export function objectId(value) {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value))
    fail(400, '잘못된 ID입니다.');
  return value;
}
export function cleanContent(value = '') {
  text(value, '본문', 1000000, false);
  return sanitizeHtml(value, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'h1',
      'h2',
      'h3',
      'ol',
      'ul',
      'li',
      'blockquote',
      'pre',
      'code',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'span',
      'sub',
      'sup',
    ],
    allowedAttributes: { a: ['href', 'title'], '*': ['class'], li: ['data-list'] },
    allowedClasses: {
      '*': [
        'ql-align-center',
        'ql-align-right',
        'ql-align-justify',
        'ql-direction-rtl',
        /^ql-indent-[1-8]$/,
      ],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
  });
}
export const serialize = (doc) => {
  const n = doc.toObject ? doc.toObject() : doc;
  return { ...n, id: String(n._id) };
};
export async function noteFilter(user) {
  return (await noteAccess(user)).filter;
}
export async function noteAccess(user) {
  if (user.role === 'admin') return { filter: {}, access: { all: true }, projectIds: [] };
  const ids = await Project.find({ isDeleted: false, 'members.userId': user.id }).distinct('_id');
  const projectIds = ids.map(String);
  const filter = { $or: [{ projectId: { $in: ids } }, { projectId: null, authorId: user.id }] };
  return { filter, access: { projectIds, authorId: String(user.id) }, projectIds };
}
export async function projectAccess(user, id, write = false, session = null) {
  if (!id) return;
  const project = await Project.findOne({ _id: objectId(String(id)), isDeleted: false }).session(
    session,
  );
  if (!project) fail(404, '프로젝트가 없습니다.');
  if (user.role === 'admin') return project;
  const member = project.members.find((m) => String(m.userId) === user.id);
  if (!member || (write && !['editor', 'manager'].includes(member.role)))
    fail(403, '프로젝트 접근 권한이 없습니다.');
  return project;
}
export async function getNote(req, { write = false, deleted = false, session = null } = {}) {
  const note = await ElnNote.findOne({ _id: objectId(req.params.id), isDeleted: deleted }).session(
    session,
  );
  if (!note) fail(404, '노트를 찾을 수 없습니다.');
  if (note.projectId) await projectAccess(req.user, note.projectId, write, session);
  else if (req.user.role !== 'admin' && String(note.authorId) !== req.user.id)
    fail(403, '노트 접근 권한이 없습니다.');
  return note;
}
export function checkVersion(note, version) {
  if (!Number.isInteger(version))
    fail(400, '현재 버전이 필요합니다. 새로고침 후 다시 시도해주세요.');
  if (note.version !== version)
    fail(409, '다른 변경이 먼저 저장되었습니다. 초안을 보존하고 최신 기록을 다시 열어주세요.');
}
export { audit };
