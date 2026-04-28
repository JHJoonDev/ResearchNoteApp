import express from 'express';
import ElnNote from '../models/ElnNote.js';
import LimsItem from '../models/LimsItem.js';
import User from '../models/User.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ eln: [], lims: [], members: [] });

  try {
    const eln = await ElnNote.find({
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { content: { $regex: q, $options: 'i' } },
        { author: { $regex: q, $options: 'i' } }
      ]
    }).select('title status author createdAt').limit(5);

    const lims = await LimsItem.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { cas: { $regex: q, $options: 'i' } },
        { brand: { $regex: q, $options: 'i' } }
      ]
    }).select('name status stockValue unit').limit(5);

    const members = await User.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).select('name email role').limit(5);

    res.json({ eln, lims, members });
  } catch (err) {
    res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
});

export default router;
