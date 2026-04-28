import express from 'express';
import AuditLog from '../models/AuditLog.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const total = await AuditLog.countDocuments();
    const logs = await AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit);

    res.json({
      logs: logs.map(log => ({
        id: log._id,
        user: log.user,
        action: log.action,
        target: log.target,
        details: log.details,
        createdAt: log.createdAt
      })),
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ message: '감사 로그를 불러오는데 실패했습니다.' });
  }
});

// Helper function to log actions
export const logAction = async (user, action, target, details = '') => {
  try {
    await AuditLog.create({ user, action, target, details });
  } catch (error) {
    console.error('AuditLog Error:', error);
  }
};

export default router;
