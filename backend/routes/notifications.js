import express from 'express';
import Notification from '../models/Notification.js';

const router = express.Router();

// GET notifications for a recipient (by name or role)
// Simplified: For now, we fetch by 'userName' or 'elnRole' passed in query
router.get('/', async (req, res) => {
    const { name, role } = req.query;
    try {
        const notifications = await Notification.find({
            $or: [
                { recipient: name },
                { recipient: role }
            ]
        }).sort({ createdAt: -1 }).limit(50);
        res.json(notifications);
    } catch (err) {
        res.status(500).json({ error: '알림 로드 실패' });
    }
});

// MARK as read
router.put('/:id/read', async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(
            req.params.id, 
            { isRead: true }, 
            { new: true }
        );
        res.json(notification);
    } catch (err) {
        res.status(400).json({ error: '알림 업데이트 실패' });
    }
});

// DELETE old notifications or specific one
router.delete('/:id', async (req, res) => {
    try {
        await Notification.findByIdAndDelete(req.params.id);
        res.json({ message: '알림 삭제 완료' });
    } catch (err) {
        res.status(400).json({ error: '알림 삭제 실패' });
    }
});

export default router;
