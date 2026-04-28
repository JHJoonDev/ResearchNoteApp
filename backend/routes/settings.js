import express from 'express';
import Settings from '../models/Settings.js';
import { logAction } from './audit.js';

const router = express.Router();

// GET settings (we assume a single settings document for the whole app)
router.get('/', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT settings
router.put('/', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings(req.body);
    } else {
      Object.assign(settings, req.body);
    }
    await settings.save();
    
    const userName = req.user ? req.user.name : '시스템';
    await logAction(userName, '수정', '시스템 설정', '시스템 설정 변경');

    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
