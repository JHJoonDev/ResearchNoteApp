import express from 'express';
import mongoose from 'mongoose';
import { auth, adminOnly } from '../middleware/auth.js';
import ElnNote from '../models/ElnNote.js';
import { audit, fail, objectId, noteAccess } from '../lib/core.js';
import { ensureSearchIndex, rebuildSearchIndex, searchIndex } from '../lib/search.js';

const router = express.Router();
const number = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) fail(400, '페이지 또는 페이지 크기를 확인해주세요.');
  return n;
};

router.get('/search', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length > 300) fail(400, '검색어는 1~300자여야 합니다.');
  const page = number(req.query.page, 1), limit = number(req.query.limit, 20, 100);
  const { access } = await noteAccess(req.user);
  const filters = {};
  if (req.query.type) {
    if (req.query.type !== 'note') fail(400, '지원하지 않는 검색 유형입니다.');
    filters.type = req.query.type;
  }
  if (req.query.projectId) filters.projectId = objectId(req.query.projectId);
  if (req.query.status) filters.status = String(req.query.status).slice(0, 40);
  await ensureSearchIndex();
  const result = await searchIndex.search({ q, access, filters, page, limit });
  const ids = result.items.map((item) => item.id);
  const notes = await ElnNote.find({ _id: { $in: ids } }).select('title').lean();
  const titles = new Map(notes.map((note) => [String(note._id), note.title]));
  const items = result.items.flatMap((item) => titles.has(item.id) ? [{
    id: item.id, type: item.type, title: titles.get(item.id),
    snippet: String(item.snippet || '').replace(/<\/?mark>/g, ''), score: item.score,
  }] : []);
  res.json({ items, total: result.total, page: result.page, limit: result.limit });
});

router.post('/admin/search/reindex', auth, adminOnly, async (req, res) => {
  let count;
  await mongoose.connection.transaction(async (session) => {
    count = await rebuildSearchIndex();
    await audit(req, 'SEARCH_REINDEX', 'SEARCH', { _id: 'notes', name: 'notes' }, null, session, `노트 ${count}개를 검색 색인에 반영했습니다.`);
  });
  res.json({ success: true, indexed: count });
});

export default router;
