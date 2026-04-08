import express from 'express';
import mongoose from 'mongoose';
import ElnNote from '../models/ElnNote.js';
import LimsItem from '../models/LimsItem.js';

const router = express.Router();

// GET all notes
router.get('/', async (req, res) => {
  try {
    const notes = await ElnNote.find().sort({ createdAt: -1 });
    const formattedNotes = notes.map(n => ({
      id: n._id,
      title: n.title,
      author: n.author,
      date: n.date,
      status: n.status,
      content: n.content,
      reagentsUsed: n.reagentsUsed || [],
      attachments: n.attachments || [],
      isStockDeducted: n.isStockDeducted || false
    }));
    res.json(formattedNotes);
  } catch (err) {
    res.status(500).json({ error: '데이터 로드 실패' });
  }
});

// GET single note
router.get('/:id', async (req, res) => {
  try {
    const note = await ElnNote.findById(req.params.id);
    if (!note) return res.status(404).json({ error: '노트를 찾을 수 없습니다' });
    res.json({
      id: note._id,
      title: note.title,
      author: note.author,
      date: note.date,
      status: note.status,
      content: note.content,
      reagentsUsed: note.reagentsUsed || [],
      attachments: note.attachments || [],
      isStockDeducted: note.isStockDeducted || false
    });
  } catch (err) {
    res.status(500).json({ error: '데이터 로드 실패' });
  }
});

// CREATE note (재고 차감 없음 - 승인 시에만 차감)
router.post('/', async (req, res) => {
  const { title, author, content, reagentsUsed, attachments } = req.body;
  const finalAuthor = author || '연구원';
  try {
    const newNote = new ElnNote({
      title,
      author: finalAuthor,
      content,
      reagentsUsed: reagentsUsed || [],
      attachments: attachments || [],
      date: new Date().toISOString().split('T')[0],
      status: '진행중'
    });

    const savedNote = await newNote.save();

    res.status(201).json({
      id: savedNote._id,
      title: savedNote.title,
      author: savedNote.author,
      date: savedNote.date,
      status: savedNote.status,
      content: savedNote.content,
      reagentsUsed: savedNote.reagentsUsed,
      attachments: savedNote.attachments,
      isStockDeducted: savedNote.isStockDeducted
    });
  } catch (err) {
    console.error('POST /eln error:', err);
    res.status(400).json({ error: '데이터 저장 실패: ' + err.message });
  }
});

// UPDATE note (승인 시 재고 차감, 승인 취소 시 재고 복구)
router.put('/:id', async (req, res) => {
  try {
    const oldNote = await ElnNote.findById(req.params.id);
    if (!oldNote) return res.status(404).json({ error: '노트를 찾을 수 없습니다' });

    // 승인됨으로 변경 & 아직 재고 미차감 → 재고 차감
    if (req.body.status === '승인됨' && !oldNote.isStockDeducted) {
      const reagentsToDeduct = req.body.reagentsUsed || oldNote.reagentsUsed || [];
      for (const reagent of reagentsToDeduct) {
        if (reagent.reagentId && mongoose.Types.ObjectId.isValid(reagent.reagentId)) {
          try {
            await LimsItem.findByIdAndUpdate(reagent.reagentId, { $inc: { stockValue: -reagent.amount } });
          } catch (itemErr) {
            console.error(`재고 차감 실패 (${reagent.reagentId}):`, itemErr.message);
          }
        }
      }
      req.body.isStockDeducted = true;
    }

    // 승인됨 → 다른 상태로 변경 & 이미 재고 차감됨 → 재고 복구
    if (req.body.status && req.body.status !== '승인됨' && oldNote.status === '승인됨' && oldNote.isStockDeducted) {
      const reagentsToReturn = oldNote.reagentsUsed || [];
      for (const reagent of reagentsToReturn) {
        if (reagent.reagentId && mongoose.Types.ObjectId.isValid(reagent.reagentId)) {
          try {
            await LimsItem.findByIdAndUpdate(reagent.reagentId, { $inc: { stockValue: reagent.amount } });
          } catch (itemErr) {
            console.error(`재고 복구 실패 (${reagent.reagentId}):`, itemErr.message);
          }
        }
      }
      req.body.isStockDeducted = false;
    }

    const updatedNote = await ElnNote.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({
      id: updatedNote._id,
      title: updatedNote.title,
      author: updatedNote.author,
      date: updatedNote.date,
      status: updatedNote.status,
      content: updatedNote.content,
      reagentsUsed: updatedNote.reagentsUsed,
      attachments: updatedNote.attachments,
      isStockDeducted: updatedNote.isStockDeducted
    });
  } catch (err) {
    console.error('PUT /eln error:', err);
    res.status(400).json({ error: '데이터 수정 실패: ' + err.message });
  }
});

// DELETE note
router.delete('/:id', async (req, res) => {
  try {
    await ElnNote.findByIdAndDelete(req.params.id);
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(400).json({ error: '데이터 삭제 실패' });
  }
});

export default router;
