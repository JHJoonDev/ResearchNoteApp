import express from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { AiError, computeSha256 } from '@labhub/ai-core';
import { auth, writer } from '../middleware/auth.js';
import { aiRateLimit, aiStatus, getAiCore } from '../lib/ai.js';
import { appendAudit } from '../lib/audit.js';
import { noteAccess, noteFilter, objectId } from '../lib/core.js';
import { readContent } from '../lib/note-doc.js';
import { docToPlainText } from '@labhub/note-format';
import AiRun from '../models/AiRun.js';
import ElnNote from '../models/ElnNote.js';
import FileAttachment from '../models/FileAttachment.js';
import { ensureSearchIndex, searchIndex } from '../lib/search.js';
import { openFile } from '../lib/storage/index.js';

const router = express.Router();
router.use(auth);
router.use(rateLimit({
  windowMs: 60_000,
  limit: aiRateLimit,
  keyGenerator: (req) => req.user.id,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ message: 'AI 요청이 너무 많습니다. 1분 후 다시 시도해주세요.' }),
}));

const isEnabled = (req, res, next) => {
  req.aiCore = getAiCore();
  if (!req.aiCore) return res.status(503).json({ message: 'AI 기능이 비활성화되어 있습니다.' });
  next();
};

function aiError(res, error) {
  const code = error instanceof AiError ? error.code : 'provider_failure';
  const mapped = {
    disabled: [503, 'AI 기능이 비활성화되어 있습니다.'],
    input_too_large: [413, '입력 크기가 허용 한도를 초과했습니다.'],
    rate_limit: [429, 'AI 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'],
    refusal: [422, 'AI가 이 요청에 답변할 수 없습니다.'],
    bad_request: [400, 'AI 요청 형식을 확인해주세요.'],
    provider_failure: [502, 'AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'],
  }[code] || [502, 'AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'];
  return res.status(mapped[0]).json({ message: mapped[1] });
}

function uniqueSourceIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => value !== null && value !== undefined).map(String))];
}

async function saveAiRun(req, feature, result, provenance, sourceIds = provenance.sourceIds) {
  const safeSources = uniqueSourceIds(sourceIds);
  const safeProvenance = { ...provenance, sourceIds: safeSources };
  let run;
  await mongoose.connection.transaction(async (session) => {
    [run] = await AiRun.create([{
      userId: req.user.id,
      feature,
      provenance: safeProvenance,
      sourceIds: safeSources,
      createdAt: new Date(safeProvenance.createdAt || Date.now()),
    }], { session });
    await appendAudit({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      action: 'AI_USE',
      targetType: 'AI_RUN',
      targetId: String(run._id),
      description: 'AI 사용 provenance',
      newState: safeProvenance,
      ipAddress: req.ip,
      session,
    });
  });
  return { result, runId: String(run._id) };
}

async function execute(req, res, feature, operation, sourceIds) {
  try {
    const { result, provenance } = await operation(req.aiCore);
    if (feature === 'askNotes' && Array.isArray(result?.warnings) && result.warnings.length) {
      result.warnings = result.warnings.map(() => '일부 인용을 원본 노트에 연결하지 못했습니다.');
      provenance.outputSha256 = computeSha256(result);
    }
    const response = await saveAiRun(req, feature, result, provenance, sourceIds ?? provenance.sourceIds);
    return res.json(response);
  } catch (error) {
    return aiError(res, error);
  }
}

async function readableNote(user, id) {
  const filter = await noteFilter(user);
  const note = await ElnNote.findOne({ _id: id, isDeleted: false, ...filter }).lean();
  return note || null;
}

async function readAttachmentWithinLimit(file, maxBytes) {
  if (Number.isSafeInteger(file.size) && file.size > maxBytes) {
    throw new AiError('AI attachment exceeds the configured size limit.', { code: 'input_too_large' });
  }
  const stream = await openFile(file);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy();
        throw new AiError('AI attachment exceeds the configured size limit.', { code: 'input_too_large' });
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('AI attachment could not be read.', { code: 'provider_failure' });
  }
  return Buffer.concat(chunks);
}

router.get('/status', (req, res) => res.json(aiStatus()));

router.post('/draft-note', isEnabled, writer, async (req, res) => {
  await execute(req, res, 'draftNote', (ai) => ai.draftNote({ memo: req.body.memo, sections: req.body.sections }));
});

router.post('/generate-protocol', isEnabled, writer, async (req, res) => {
  await execute(req, res, 'generateProtocol', (ai) => ai.generateProtocol({ instruction: req.body.instruction }));
});

router.post('/extract-tables', isEnabled, writer, async (req, res) => {
  if (req.body.attachmentId !== undefined) {
    if (req.body.text !== undefined) return res.status(400).json({ message: '텍스트 또는 첨부 파일 중 하나만 지정해주세요.' });
    let attachment;
    try {
      const id = objectId(req.body.attachmentId);
      attachment = await FileAttachment.findOne({ _id: id, isDeleted: false }).lean();
      if (!attachment || !(await readableNote(req.user, attachment.noteId))) return res.status(404).json({ message: '첨부 파일을 찾을 수 없습니다.' });
      if (!['image/png', 'image/jpeg', 'application/pdf'].includes(attachment.mimeType)) return res.status(400).json({ message: 'PNG, JPEG 또는 PDF 첨부 파일만 사용할 수 있습니다.' });
      const bytes = await readAttachmentWithinLimit(attachment, req.aiCore.limits.maxMediaBytes);
      const args = attachment.mimeType === 'application/pdf'
        ? { pdfBase64: bytes.toString('base64') }
        : { imageBase64: bytes.toString('base64'), mediaType: attachment.mimeType };
      await execute(req, res, 'extractTables', (ai) => ai.extractTables(args), [String(attachment._id)]);
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ message: '첨부 파일 ID를 확인해주세요.' });
      return aiError(res, error);
    }
    return;
  }
  await execute(req, res, 'extractTables', (ai) => ai.extractTables({ text: req.body.text }));
});

router.post('/check-note', isEnabled, async (req, res) => {
  let id;
  try { id = objectId(req.body.noteId); }
  catch { return res.status(400).json({ message: '노트 ID를 확인해주세요.' }); }
  try {
    const note = await readableNote(req.user, id);
    if (!note) return res.status(404).json({ message: '노트를 찾을 수 없습니다.' });
    const doc = readContent(note).contentDoc;
    await execute(req, res, 'checkNote', (ai) => ai.checkNote({ doc }), [String(note._id)]);
  } catch (error) {
    return aiError(res, error);
  }
});

router.post('/ask', isEnabled, async (req, res) => {
  if (typeof req.body.question !== 'string' || !req.body.question.trim()) return res.status(400).json({ message: '질문을 입력해주세요.' });
  if (req.body.question.length > req.aiCore.limits.maxTextLength) return res.status(413).json({ message: '입력 크기가 허용 한도를 초과했습니다.' });
  const limit = req.body.limit === undefined ? 5 : Number(req.body.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) return res.status(400).json({ message: '검색 개수는 1~10 사이여야 합니다.' });
  const { access } = await noteAccess(req.user);
  await execute(req, res, 'askNotes', (ai) => ai.askNotes({
    question: req.body.question,
    limit,
    access,
    retrieve: async ({ q, access: currentAccess, limit: requestedLimit }) => {
      await ensureSearchIndex();
      const found = await searchIndex.search({ q, access: currentAccess, filters: { type: 'note' }, page: 1, limit: requestedLimit || limit });
      const ids = uniqueSourceIds((found.items || []).map((item) => item.id));
      if (!ids.length) return [];
      const filter = await noteFilter(req.user);
      const notes = await ElnNote.find({ _id: { $in: ids }, isDeleted: false, ...filter }).lean();
      const byId = new Map(notes.map((note) => [String(note._id), note]));
      return ids.flatMap((id) => {
        const note = byId.get(id);
        if (!note) return [];
        const doc = readContent(note).contentDoc;
        return [{ id, title: note.title, text: docToPlainText(doc) }];
      });
    },
  }));
});

export default router;
