import express from 'express';
import mongoose from 'mongoose';
import { body, validationResult } from 'express-validator';
import ElnNote from '../models/ElnNote.js';
import LimsItem from '../models/LimsItem.js';
import Notification from '../models/Notification.js';

const router = express.Router();

// GET all notes
router.get('/', async (req, res) => {
  const { search, page: pageQuery, limit: limitQuery } = req.query;
  try {
    let query = {};
    if (search) {
      query = { $text: { $search: search } };
    }
    
    const page = parseInt(pageQuery) || 1;
    const limit = parseInt(limitQuery) || 10;
    const skip = (page - 1) * limit;

    const total = await ElnNote.countDocuments(query);
    const notes = await ElnNote.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
    
    const formattedNotes = notes.map(n => ({
      id: n._id,
      title: n.title,
      author: n.author,
      date: n.date,
      status: n.status,
      content: n.content,
      approvals: n.approvals || [],
      reagentsUsed: n.reagentsUsed || [],
      attachments: n.attachments || [],
      isStockDeducted: n.isStockDeducted || false,
      isTemplate: n.isTemplate || false,
      history: n.history || [],
      tags: n.tags || []
    }));
    
    res.json({
      items: formattedNotes,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
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
      approvals: note.approvals || [],
      reagentsUsed: note.reagentsUsed || [],
      attachments: note.attachments || [],
      isStockDeducted: note.isStockDeducted || false,
      isTemplate: note.isTemplate || false,
      history: note.history || [],
      tags: note.tags || []
    });
  } catch (err) {
    res.status(500).json({ error: '데이터 로드 실패' });
  }
});

// CREATE note (재고 차감 없음 - 승인 시에만 차감)
router.post('/', [
  body('title').notEmpty().withMessage('제목을 입력하세요.'),
  body('author').notEmpty().withMessage('작성자가 없습니다.')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  
  const { title, author, content, reagentsUsed, attachments, isTemplate } = req.body;
  const finalAuthor = author || '연구원';
  try {
    const newNote = new ElnNote({
      title,
      author: finalAuthor,
      content,
      reagentsUsed: reagentsUsed || [],
      attachments: attachments || [],
      approvals: [],
      date: new Date().toISOString().split('T')[0],
      status: '진행중',
      isTemplate: isTemplate || false,
      history: []
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
      isStockDeducted: savedNote.isStockDeducted,
      isTemplate: savedNote.isTemplate,
      history: savedNote.history
    });

    // 알림 생성: 새 연구노트 작성 시 책임연구원에게 알림
    if (!isTemplate) {
      await Notification.create({
        recipient: '책임연구원',
        type: 'approval_request',
        message: `${finalAuthor}님이 새로운 연구노트("${title}")를 작성하였습니다. 1차 승인이 필요합니다.`,
        link: `/eln/${savedNote._id}`
      });
    }
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

    let updateData = { ...req.body };

    // approvals 처리 로직
    if (updateData.status === '1차 승인' || updateData.status === '승인됨') {
      if (updateData.approverName) {
        if (!updateData.$push) updateData.$push = {};
        updateData.$push.approvals = { name: updateData.approverName, date: new Date() };
        delete updateData.approverName;
      }
    } else if (updateData.status === '반려' || updateData.status === '진행중') {
      updateData.approvals = [];
    }

    // 승인됨으로 변경 & 아직 재고 미차감 → 재고 차감
    if (updateData.status === '승인됨' && !oldNote.isStockDeducted) {
      const reagentsToDeduct = updateData.reagentsUsed || oldNote.reagentsUsed || [];
      for (const reagent of reagentsToDeduct) {
        if (reagent.reagentId && mongoose.Types.ObjectId.isValid(reagent.reagentId)) {
          try {
            await LimsItem.findByIdAndUpdate(reagent.reagentId, { $inc: { stockValue: -reagent.amount } });
          } catch (itemErr) {
            console.error(`재고 차감 실패 (${reagent.reagentId}):`, itemErr.message);
          }
        }
      }
      updateData.isStockDeducted = true;
    }

    // 승인됨 → 다른 상태로 변경 & 이미 재고 차감됨 → 재고 복구
    if (updateData.status && updateData.status !== '승인됨' && oldNote.status === '승인됨' && oldNote.isStockDeducted) {
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
      updateData.isStockDeducted = false;
    }

    // History (Audit Trail) 처리 로직
    if (!updateData.$push) updateData.$push = {};
    
    // Only push history if there is actual editing (e.g. editorName is provided during manual save)
    // Or if status changed via approval/rejection
    if (updateData.editorName || updateData.approverName || updateData.status !== oldNote.status) {
      const currentVersion = (oldNote.history && oldNote.history.length) ? oldNote.history.length + 1 : 1;
      updateData.$push.history = {
        version: currentVersion,
        content: updateData.content !== undefined ? updateData.content : oldNote.content,
        title: updateData.title !== undefined ? updateData.title : oldNote.title,
        updatedBy: updateData.editorName || updateData.approverName || 'System',
        updatedAt: new Date()
      };
      delete updateData.editorName;
    }

    const updatedNote = await ElnNote.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({
      id: updatedNote._id,
      title: updatedNote.title,
      author: updatedNote.author,
      date: updatedNote.date,
      status: updatedNote.status,
      content: updatedNote.content,
      approvals: updatedNote.approvals,
      reagentsUsed: updatedNote.reagentsUsed,
      attachments: updatedNote.attachments,
      isStockDeducted: updatedNote.isStockDeducted,
      isTemplate: updatedNote.isTemplate,
      history: updatedNote.history
    });

    // 알림 생성 로직
    if (updateData.status && updateData.status !== oldNote.status) {
      if (updateData.status === '1차 승인') {
        // 책임연구원이 승인 완료 -> 연구소장에게 알림
        await Notification.create({
          recipient: '연구소장',
          type: 'approval_request',
          message: `"${updatedNote.title}" 연구노트의 1차 승인이 완료되었습니다. 최종 승인이 필요합니다.`,
          link: `/eln/${updatedNote._id}`
        });
      } else if (updateData.status === '승인됨') {
        // 연구소장이 최종 승인 -> 작성자에게 알림
        await Notification.create({
          recipient: updatedNote.author,
          type: 'approved',
          message: `축하합니다! "${updatedNote.title}" 연구노트가 최종 승인되었습니다.`,
          link: `/eln/${updatedNote._id}`
        });
      } else if (updateData.status === '반려') {
        // 승인 거절 -> 작성자에게 알림
        await Notification.create({
          recipient: updatedNote.author,
          type: 'rejected',
          message: `"${updatedNote.title}" 연구노트가 반려되었습니다. 내용을 확인해 주세요.`,
          link: `/eln/${updatedNote._id}`
        });
      }
    }
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

// Add comment
router.post('/:id/comments', async (req, res) => {
  try {
    const note = await ElnNote.findById(req.params.id);
    if (!note) return res.status(404).json({ error: '노트를 찾을 수 없습니다.' });

    note.comments = note.comments || [];
    note.comments.push({
      author: req.body.author,
      text: req.body.text,
      createdAt: new Date()
    });

    await note.save();
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: '댓글 작성 실패' });
  }
});

export default router;
