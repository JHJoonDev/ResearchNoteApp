import express from 'express';
import User from '../models/User.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await User.findOne({ email });
    if (user && user.password === password) {
      res.json({
        success: true,
        token: 'mock-jwt-token-12345',
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

router.post('/logout', (req, res) => {
  res.json({ success: true, message: '로그아웃 되었습니다.' });
});

export default router;
