import express from 'express';
import mongoose from 'mongoose';
import { body, validationResult } from 'express-validator';
import ElnNote from '../models/ElnNote.js';
import LimsItem from '../models/LimsItem.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendEmail } from '../utils/email.js';
import { requireRole } from '../middleware/authMiddleware.js';
import { logAction } from './audit.js';

const router = express.Router();

// Rename project (Admin only)
router.put('/project/rename', requireRole(['admin']), async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    const tenantId = req.user?.tenantId;
    if (!oldName || !newName) return res.status(400).json({ success: false, message: '이전 이름과 새 이름을 모두 입력해야 합니다.' });

    const filter = { project: oldName };
    if (tenantId) filter.tenantId = tenantId;

    const result = await ElnNote.updateMany(filter, { $set: { project: newName } });
    
    await logAction(req.user.name, '수정', '프로젝트 관리', `프로젝트명 변경: ${oldName} -> ${newName} (${result.modifiedCount}건)`);
    
    res.json({ success: true, message: '프로젝트 이름이 변경되었습니다.', modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('Project rename error:', err);
    res.status(500).json({ success: false, message: '프로젝트 이름 변경 실패' });
  }
});

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
      project: n.project,
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
      project: note.project,
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
router.post('/', requireRole(['admin', 'researcher']), [
  body('title').notEmpty().withMessage('제목을 입력하세요.'),
  body('author').notEmpty().withMessage('작성자가 없습니다.')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  
  const { title, project, author, content, reagentsUsed, attachments, isTemplate } = req.body;
  const finalAuthor = author || '연구원';
  try {
    const newNote = new ElnNote({
      title,
      project: project || '기본 프로젝트',
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
      project: savedNote.project,
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
      const notification = await Notification.create({
        recipient: '책임연구원',
        type: 'approval_request',
        message: `${finalAuthor}님이 새로운 연구노트("${title}")를 작성하였습니다. 1차 승인이 필요합니다.`,
        link: `/eln/${savedNote._id}`
      });
      if (req.io) req.io.emit('newNotification', notification);
      
      const managers = await User.find({ elnRole: 'manager' });
      managers.forEach(manager => {
        if (manager.email) {
          sendEmail(manager.email, `[LabHub] 1차 승인 요청`, `${finalAuthor}님이 새로운 연구노트("${title}")를 작성하였습니다.`);
        }
      });
      await logAction(finalAuthor, '작성', '연구노트', `새 노트 작성: ${title}`);
    }
  } catch (err) {
    console.error('POST /eln error:', err);
    res.status(400).json({ error: '데이터 저장 실패: ' + err.message });
  }
});

// UPDATE note (승인 시 재고 차감, 승인 취소 시 재고 복구)
router.put('/:id', requireRole(['admin', 'researcher']), async (req, res) => {
  try {
    const oldNote = await ElnNote.findById(req.params.id);
    if (!oldNote) return res.status(404).json({ error: '노트를 찾을 수 없습니다' });

    let updateData = { ...req.body };

    // 권한 검사 로직
    if (updateData.status === '1차 승인' && oldNote.status !== '1차 승인') {
      if (!['책임연구원', '연구소장'].includes(req.user.elnRole)) {
        return res.status(403).json({ error: '1차 승인 권한이 없습니다.' });
      }
    }
    if (updateData.status === '승인됨' && oldNote.status !== '승인됨') {
      if (req.user.elnRole !== '연구소장') {
        return res.status(403).json({ error: '최종 승인 권한이 없습니다.' });
      }
    }

    // approvals 처리 로직
    if (updateData.status === '1차 승인' || updateData.status === '승인됨') {
      if (updateData.approverName) {
        if (!updateData.$push) updateData.$push = {};
        updateData.$push.approvals = { name: updateData.approverName, date: new Date(), signature: updateData.signature };
        delete updateData.approverName;
        delete updateData.signature;
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
      await logAction(updateData.editorName || oldNote.author || '연구원', '수정', '연구노트', `노트 업데이트: ${updateData.title || oldNote.title}`);
      delete updateData.editorName;
    }

    const updatedNote = await ElnNote.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({
      id: updatedNote._id,
      title: updatedNote.title,
      project: updatedNote.project,
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
      let notification = null;
      if (updateData.status === '1차 승인') {
        // 책임연구원이 승인 완료 -> 연구소장에게 알림
        notification = await Notification.create({
          recipient: '연구소장',
          type: 'approval_request',
          message: `"${updatedNote.title}" 연구노트의 1차 승인이 완료되었습니다. 최종 승인이 필요합니다.`,
          link: `/eln/${updatedNote._id}`
        });
        const directors = await User.find({ elnRole: 'director' });
        directors.forEach(director => {
          if (director.email) {
            sendEmail(director.email, `[LabHub] 최종 승인 요청`, `"${updatedNote.title}" 연구노트가 1차 승인되어 최종 승인을 기다리고 있습니다.`);
          }
        });
        await logAction(req.user?.name || '시스템', '승인', '연구노트', `1차 승인: ${updatedNote.title}`);
      } else if (updateData.status === '승인됨') {
        // 연구소장이 최종 승인 -> 작성자에게 알림
        notification = await Notification.create({
          recipient: updatedNote.author,
          type: 'approved',
          message: `축하합니다! "${updatedNote.title}" 연구노트가 최종 승인되었습니다.`,
          link: `/eln/${updatedNote._id}`
        });
        const authorUser = await User.findOne({ name: updatedNote.author });
        if (authorUser && authorUser.email) {
          await sendEmail(authorUser.email, `[LabHub] 연구노트 최종 승인 완료`, `"${updatedNote.title}" 연구노트가 최종 승인되었습니다.`);
        }
        await logAction(req.user?.name || '시스템', '승인', '연구노트', `최종 승인: ${updatedNote.title}`);
      } else if (updateData.status === '반려') {
        // 승인 거절 -> 작성자에게 알림
        notification = await Notification.create({
          recipient: updatedNote.author,
          type: 'rejected',
          message: `"${updatedNote.title}" 연구노트가 반려되었습니다. 내용을 확인해 주세요.`,
          link: `/eln/${updatedNote._id}`
        });
        const authorUser = await User.findOne({ name: updatedNote.author });
        if (authorUser && authorUser.email) {
          await sendEmail(authorUser.email, `[LabHub] 연구노트 반려 알림`, `"${updatedNote.title}" 연구노트가 반려되었습니다. 앱에서 확인해 주세요.`);
        }
        await logAction(req.user?.name || '시스템', '반려', '연구노트', `반려: ${updatedNote.title}`);
      }
      
      if (notification && req.io) {
        req.io.emit('newNotification', notification);
      }
    }
  } catch (err) {
    console.error('PUT /eln error:', err);
    res.status(400).json({ error: '데이터 수정 실패: ' + err.message });
  }
});

// DELETE note
router.delete('/:id', requireRole(['admin', 'researcher']), async (req, res) => {
  try {
    const deleted = await ElnNote.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: '노트를 찾을 수 없습니다' });
    await logAction(req.user?.name || '시스템', '삭제', '연구노트', `삭제됨: ${deleted.title}`);
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(400).json({ error: '데이터 삭제 실패' });
  }
});

// Add comment
router.post('/:id/comments', requireRole(['admin', 'researcher']), async (req, res) => {
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
