import express from 'express';
import LimsItem from '../models/LimsItem.js';
import { requireRole } from '../middleware/authMiddleware.js';
import { body, validationResult } from 'express-validator';
import { logAction } from './audit.js';

const validateLims = [
  body('name').notEmpty().withMessage('시약명을 입력하세요.'),
  body('stockValue').isNumeric().withMessage('재고량은 숫자여야 합니다.'),
  body('unit').notEmpty().withMessage('단위를 입력하세요.'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    next();
  }
];

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const total = await LimsItem.countDocuments();
    const items = await LimsItem.find().sort({ createdAt: -1 }).skip(skip).limit(limit);
    
    const formattedItems = items.map(item => ({
      id: item._id,
      name: item.name,
      cas: item.cas,
      brand: item.brand,
      stockValue: item.stockValue,
      unit: item.unit,
      stock: `${item.stockValue} ${item.unit}`,
      status: item.status,
      expiryDate: item.expiryDate,
      history: item.history
    }));
    
    res.json({
      items: formattedItems,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    res.status(500).json({ error: '데이터 로드 실패' });
  }
});

router.post('/', requireRole(['admin', 'researcher']), validateLims, async (req, res) => {
  try {
    const userName = req.user ? req.user.name : '알 수 없음';
    const newItem = new LimsItem({
      ...req.body,
      status: '양호',
      history: [{
        action: '입고',
        amount: req.body.stockValue,
        user: userName,
        reason: '초기 입고'
      }]
    });
    const savedItem = await newItem.save();
    await logAction(userName, '등록', '시약', `새 시약 등록: ${savedItem.name}`);
    res.status(201).json({
      id: savedItem._id,
      name: savedItem.name,
      cas: savedItem.cas,
      brand: savedItem.brand,
      stockValue: savedItem.stockValue,
      unit: savedItem.unit,
      stock: `${savedItem.stockValue} ${savedItem.unit}`,
      status: savedItem.status,
      expiryDate: savedItem.expiryDate
    });
  } catch (err) {
    res.status(400).json({ error: '데이터 저장 실패' });
  }
});

router.put('/:id', requireRole(['admin', 'researcher']), async (req, res) => {
  try {
    const userName = req.user ? req.user.name : '알 수 없음';
    const oldItem = await LimsItem.findById(req.params.id);
    let historyUpdate = req.body.history || [];
    
    if (oldItem && req.body.stockValue !== undefined && req.body.stockValue !== oldItem.stockValue) {
      const diff = req.body.stockValue - oldItem.stockValue;
      historyUpdate = [...oldItem.history, {
        action: diff > 0 ? '입고' : '출고',
        amount: Math.abs(diff),
        user: userName,
        reason: req.body.reason || (diff > 0 ? '재고 추가' : '사용 차감')
      }];
    }

    const updateData = { ...req.body };
    if (historyUpdate.length > 0) {
      updateData.history = historyUpdate;
    }

    const updatedItem = await LimsItem.findByIdAndUpdate(req.params.id, updateData, { new: true });
    await logAction(userName, '수정', '시약', `시약 정보 업데이트: ${updatedItem.name}`);
    res.json({
      id: updatedItem._id,
      name: updatedItem.name,
      cas: updatedItem.cas,
      brand: updatedItem.brand,
      stockValue: updatedItem.stockValue,
      unit: updatedItem.unit,
      stock: `${updatedItem.stockValue} ${updatedItem.unit}`,
      status: updatedItem.status,
      expiryDate: updatedItem.expiryDate
    });
  } catch (err) {
    res.status(400).json({ error: '데이터 수정 실패' });
  }
});

router.delete('/:id', requireRole(['admin', 'researcher']), async (req, res) => {
  try {
    const deleted = await LimsItem.findByIdAndDelete(req.params.id);
    if (deleted) await logAction(req.user?.name || '시스템', '삭제', '시약', `시약 삭제: ${deleted.name}`);
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(400).json({ error: '데이터 삭제 실패' });
  }
});

export default router;
