import express from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { logAction } from './audit.js';

const router = express.Router();

router.post('/login', [
  body('email').isEmail().withMessage('유효한 이메일을 입력하세요.'),
  body('password').notEmpty().withMessage('비밀번호를 입력하세요.')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
  }

  const { email, password } = req.body;
  
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 잘못되었습니다.' });
    }

    const isMatch = await user.comparePassword(password);
    if (isMatch) {
      const token = jwt.sign(
        { id: user._id, role: user.role, elnRole: user.elnRole },
        process.env.JWT_SECRET || 'fallback_secret_key',
        { expiresIn: '1d' }
      );
      
      await logAction(user.name, '로그인', '시스템', '성공적으로 로그인했습니다.');

      res.json({
        success: true,
        token: token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          elnRole: user.elnRole || '연구원'
        }
      });
    } else {
      res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 잘못되었습니다.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

router.post('/register', [
  body('email').isEmail().withMessage('유효한 이메일을 입력하세요.'),
  body('password').isLength({ min: 6 }).withMessage('비밀번호는 최소 6자 이상이어야 합니다.'),
  body('name').notEmpty().withMessage('이름을 입력하세요.')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { email, password, name } = req.body;
  
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ success: false, message: '이미 사용 중인 이메일입니다.' });

    // elnRole is default '연구원'
    const newUser = new User({ email, password, name, role: 'viewer', elnRole: '연구원' });
    await newUser.save();
    res.status(201).json({ success: true, message: '가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.' });
  } catch (err) {
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  const { name, password, newPassword, notificationSettings } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

    if (name) user.name = name;
    
    if (password && newPassword) {
      const isMatch = await user.comparePassword(password);
      if (!isMatch) return res.status(400).json({ success: false, message: '현재 비밀번호가 일치하지 않습니다.' });
      user.password = newPassword;
    }

    if (notificationSettings) {
      user.notificationSettings = { ...user.notificationSettings, ...notificationSettings };
    }

    await user.save();
    res.json({
      success: true,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role, 
        elnRole: user.elnRole,
        notificationSettings: user.notificationSettings
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '프로필 업데이트 실패' });
  }
});

router.post('/logout', (req, res) => {
  res.json({ success: true, message: '로그아웃 되었습니다.' });
});

export default router;
