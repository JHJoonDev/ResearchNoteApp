import express from 'express';
import ElnTemplate from '../models/ElnTemplate.js';
import mongoose from 'mongoose';
import { auth, writer } from '../middleware/auth.js';
import { text, cleanContent, objectId, fail, audit } from '../lib/core.js';
const router = express.Router();
router.use(auth);
router.get('/', async (req, res) =>
  res.json(await ElnTemplate.find({ isDeleted: false }).sort({ createdAt: -1 })),
);
router.post('/', writer, async (req, res) => {
  let template;
  await mongoose.connection.transaction(async (session) => {
    [template] = await ElnTemplate.create([{
        name: text(req.body.name, '템플릿 이름'),
        description: text(req.body.description || '', '설명', 2000, false),
        content: cleanContent(req.body.content),
        authorId: req.user.id,
      }], { session });
    await audit(req, 'TEMPLATE_CREATE', 'TEMPLATE', template, null, session);
  });
  res.status(201).json(template);
});
router.delete('/:id', writer, async (req, res) => {
  await mongoose.connection.transaction(async (session) => {
    const t = await ElnTemplate.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!t) fail(404, '템플릿이 없습니다.');
    if (req.user.role !== 'admin' && String(t.authorId) !== req.user.id) fail(403, '작성자 또는 관리자만 삭제할 수 있습니다.');
    const before = t.toObject();
    t.isDeleted = true;
    await t.save({ session });
    await audit(req, 'TEMPLATE_DELETE', 'TEMPLATE', t, before, session);
  });
  res.json({ success: true });
});
export default router;
