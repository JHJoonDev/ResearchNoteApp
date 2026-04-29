import express from 'express';
import User from '../models/User.js';
import { requireRole } from '../middleware/authMiddleware.js';
import { body, validationResult } from 'express-validator';

const validateMember = [
  body('name').notEmpty().withMessage('이름을 입력하세요.'),
  body('email').isEmail().withMessage('유효한 이메일을 입력하세요.'),
  body('role').isIn(['admin', 'researcher', 'viewer']).withMessage('올바른 권한을 선택하세요.'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    next();
  }
];

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const members = await User.find().select('-password').sort({ createdAt: -1 });
    const formattedMembers = members.map(m => ({
      id: m._id,
      name: m.name,
      email: m.email,
      role: m.role,
      elnRole: m.elnRole || '연구원'
    }));
    res.json(formattedMembers);
  } catch (err) {
    res.status(500).json({ error: '데이터 로드 실패' });
  }
});

router.post('/', requireRole(['admin']), validateMember, async (req, res) => {
  try {
    const newMember = new User({
      ...req.body,
      password: 'password' // In real app, generate temp password or email link
    });
    const savedMember = await newMember.save();
    res.status(201).json({
      id: savedMember._id,
      name: savedMember.name,
      email: savedMember.email,
      role: savedMember.role,
      elnRole: savedMember.elnRole || '연구원'
    });
  } catch (err) {
    res.status(400).json({ error: '데이터 저장 실패' });
  }
});

router.put('/:id', requireRole(['admin']), validateMember, async (req, res) => {
  try {
    const updatedMember = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({
      id: updatedMember._id,
      name: updatedMember.name,
      email: updatedMember.email,
      role: updatedMember.role,
      elnRole: updatedMember.elnRole || '연구원'
    });
  } catch (err) {
    res.status(400).json({ error: '데이터 수정 실패' });
  }
});

router.delete('/:id', requireRole(['admin']), async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(400).json({ error: '데이터 삭제 실패' });
  }
});

export default router;
