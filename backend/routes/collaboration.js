import express from 'express';
import mongoose from 'mongoose';
import Comment from '../models/Comment.js';
import ElnNote from '../models/ElnNote.js';
import Notification from '../models/Notification.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { auth, writer } from '../middleware/auth.js';
import { audit, fail, getNote, objectId, noteFilter, text } from '../lib/core.js';
import { projectManagerAllowed, reviewerAllowed } from '../lib/note-permissions.js';
import { deliverNotifications } from '../lib/notifications.js';

const router = express.Router();
function pageValue(value, fallback, max) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) fail(400, '페이지 또는 페이지 크기를 확인해주세요.');
  return n;
}
async function visibleMentionIds(note, input, session) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 50) fail(400, '언급 대상은 최대 50명까지 지정할 수 있습니다.');
  const ids = [...new Set(input.map((id) => objectId(id)))];
  if (!note.projectId) return [];
  const project = await Project.findOne({ _id: note.projectId, isDeleted: false }).session(session);
  const members = new Set((project?.members || []).map((m) => String(m.userId)));
  return ids.filter((id) => members.has(id));
}

router.get('/eln/review-queue', auth, async (req, res) => {
  const page = pageValue(req.query.page, 1, 1000000), limit = pageValue(req.query.limit, 20, 100);
  const filter = { ...(await noteFilter(req.user)), status: '승인대기', isDeleted: false };
  const candidates = await ElnNote.find(filter).sort({ updatedAt: -1 });
  const allowed = [];
  for (const note of candidates) if (await reviewerAllowed(note, req.user)) allowed.push(note);
  const total = allowed.length;
  const items = allowed.slice((page - 1) * limit, page * limit).map((note) => ({
    id: String(note._id), title: note.title, author: note.author, status: note.status,
    projectId: note.projectId ? String(note.projectId) : null, version: note.version, updatedAt: note.updatedAt,
  }));
  res.json({ items, total, page, limit });
});

router.get('/eln/:id/comments', auth, async (req, res) => {
  const note = await getNote(req);
  res.json(await Comment.find({ noteId: note._id, isDeleted: false }).sort({ createdAt: 1 }));
});

router.post('/eln/:id/comments', auth, writer, async (req, res) => {
  const body = text(req.body.body, '댓글', 4000);
  if (req.body.blockIndex !== undefined && req.body.blockIndex !== null && (!Number.isSafeInteger(req.body.blockIndex) || req.body.blockIndex < 0)) fail(400, '댓글 위치를 확인해주세요.');
  let comment, ownerId = null, mentionedIds = [];
  await mongoose.connection.transaction(async (session) => {
    const note = await getNote(req, { session });
    let parentId = null;
    if (req.body.parentId) {
      const parent = await Comment.findOne({ _id: objectId(req.body.parentId), noteId: note._id, isDeleted: false }).session(session);
      if (!parent) fail(400, '답글 대상은 이 노트의 댓글이어야 합니다.');
      parentId = parent._id;
    }
    const mentions = await visibleMentionIds(note, req.body.mentions, session);
    [comment] = await Comment.create([{ noteId: note._id, parentId, authorId: req.user.id, authorName: req.user.name, body, blockIndex: req.body.blockIndex ?? null, mentions }], { session });
    await audit(req, 'COMMENT_CREATE', 'COMMENT', comment, null, session);
    ownerId = String(note.authorId);
    mentionedIds = mentions.filter((id) => id !== req.user.id);
  });
  if (ownerId !== req.user.id) await deliverNotifications([ownerId], { type: 'commented', noteId: comment.noteId, actorName: req.user.name, message: `${req.user.name}님이 노트에 댓글을 남겼습니다.` });
  if (mentionedIds.length) await deliverNotifications(mentionedIds, { type: 'mentioned', noteId: comment.noteId, actorName: req.user.name, message: `${req.user.name}님이 댓글에서 회원님을 언급했습니다.` });
  res.status(201).json(comment);
});

router.put('/comments/:id', auth, writer, async (req, res) => {
  const body = text(req.body.body, '댓글', 4000);
  let comment;
  await mongoose.connection.transaction(async (session) => {
    comment = await Comment.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!comment) fail(404, '댓글이 없습니다.');
    req.params.id = String(comment.noteId);
    await getNote(req, { session });
    if (String(comment.authorId) !== req.user.id) fail(403, '댓글 작성자만 수정할 수 있습니다.');
    const before = comment.toObject(); comment.body = body; comment.editedAt = new Date();
    await comment.save({ session });
    await audit(req, 'COMMENT_UPDATE', 'COMMENT', comment, before, session);
  });
  res.json(comment);
});

router.delete('/comments/:id', auth, writer, async (req, res) => {
  await mongoose.connection.transaction(async (session) => {
    const comment = await Comment.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!comment) fail(404, '댓글이 없습니다.');
    req.params.id = String(comment.noteId);
    const note = await getNote(req, { session });
    if (String(comment.authorId) !== req.user.id && !(await projectManagerAllowed(note, req.user, session))) fail(403, '댓글 작성자, 프로젝트 관리자 또는 시스템 관리자만 삭제할 수 있습니다.');
    const before = comment.toObject(); comment.isDeleted = true;
    await comment.save({ session });
    await audit(req, 'COMMENT_DELETE', 'COMMENT', comment, before, session);
  });
  res.json({ success: true });
});

router.post('/comments/:id/resolve', auth, writer, async (req, res) => {
  let comment;
  await mongoose.connection.transaction(async (session) => {
    comment = await Comment.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!comment) fail(404, '댓글이 없습니다.');
    req.params.id = String(comment.noteId);
    const note = await getNote(req, { session });
    if (String(comment.authorId) !== req.user.id && !(await projectManagerAllowed(note, req.user, session))) fail(403, '댓글 작성자, 프로젝트 관리자 또는 시스템 관리자만 해결 상태를 변경할 수 있습니다.');
    const before = comment.toObject(); comment.resolvedAt = comment.resolvedAt ? undefined : new Date();
    await comment.save({ session });
    await audit(req, 'COMMENT_RESOLVE', 'COMMENT', comment, before, session);
  });
  res.json(comment);
});

router.get('/notifications', auth, async (req, res) => {
  const page = pageValue(req.query.page, 1, 1000000), limit = pageValue(req.query.limit, 20, 100);
  const unreadOnly = req.query.unread === 'true';
  const filter = { userId: req.user.id, ...(unreadOnly ? { readAt: { $exists: false } } : {}) };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: req.user.id, readAt: { $exists: false } }),
  ]);
  res.json({ items, total, unread, page, limit });
});

router.post('/notifications/:id/read', auth, async (req, res) => {
  const result = await Notification.findOneAndUpdate({ _id: objectId(req.params.id), userId: req.user.id, readAt: { $exists: false } }, { $set: { readAt: new Date() } }, { returnDocument: 'after' });
  if (!result) {
    const exists = await Notification.exists({ _id: objectId(req.params.id), userId: req.user.id });
    if (!exists) fail(404, '알림이 없습니다.');
    return res.json({ success: true });
  }
  res.json({ success: true, item: result });
});

router.post('/notifications/read-all', auth, async (req, res) => {
  const result = await Notification.updateMany({ userId: req.user.id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  res.json({ success: true, updated: result.modifiedCount });
});

export default router;
