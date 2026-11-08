import express from 'express';
import rateLimit from 'express-rate-limit';
import NoteSeal from '../models/NoteSeal.js';
import { verifySeal } from '../lib/seal/verify.js';
import { fail } from '../lib/core.js';

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { message: '검증 요청이 많습니다. 잠시 후 다시 시도해주세요.' } }));
router.get('/verify/:verifyId', async (req, res) => {
  const seal = await NoteSeal.findOne({ verifyId: req.params.verifyId });
  if (!seal) fail(404, '검증 정보를 찾을 수 없습니다.');
  const result = await verifySeal(seal);
  res.json({
    valid: result.valid,
    sealedAt: seal.createdAt,
    sealHash: seal.sealHash,
    pdfSha256: seal.pdfSha256,
    timestamp: {
      status: result.timestamp.status,
      genTime: result.timestamp.genTime || seal.timestamp.genTime,
      tsaName: result.timestamp.tsaName || seal.timestamp.tsaName,
      isTrusted: Boolean(result.timestamp.isTrusted),
    },
    algorithm: 'Ed25519 + SHA-256',
  });
});
export default router;
