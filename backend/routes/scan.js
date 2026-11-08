import express from 'express';
import { auth } from '../middleware/auth.js';
import { resolveScan } from './labels.js';
const router = express.Router();
router.get('/resolve', auth, resolveScan);
export default router;
