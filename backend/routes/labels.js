import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeLabel, renderZpl, resolveTemplate, resolveSheetTemplate } from '@labhub/label-kit';
import { renderSheetPdf } from '@labhub/label-kit/pdf';
import LimsItem from '../models/LimsItem.js';
import LimsLot from '../models/LimsLot.js';
import Entity from '../models/Entity.js';
import EntityType from '../models/EntityType.js';
import Location from '../models/Location.js';
import { auth } from '../middleware/auth.js';
import { fail, objectId, projectAccess } from '../lib/core.js';

const router = express.Router(); router.use(auth);
const root = path.dirname(fileURLToPath(import.meta.url));
const fontPath = path.resolve(root, '../assets/fonts/NotoSansKR.ttf');

async function resolveItem(req, type, rawId) {
  const id = objectId(rawId);
  if (type === 'reagent') {
    const item = await LimsItem.findOne({ _id: id, isDeleted: false });
    if (!item) fail(404, '항목을 찾을 수 없습니다.');
    return { type, id, title: item.name, detailLines: [`${item.stockValue} ${item.unit}`, item.brand], ghsCodes: item.ghsPictograms || [], url: `/lims/${id}` };
  }
  if (type === 'lot') {
    const lot = await LimsLot.findOne({ _id: id, isDeleted: false });
    if (!lot) fail(404, '항목을 찾을 수 없습니다.');
    const reagent = await LimsItem.findOne({ _id: lot.reagentId, isDeleted: false });
    if (!reagent) fail(404, '항목을 찾을 수 없습니다.');
    return { type, id, title: lot.lotNumber, detailLines: [reagent.name, `${lot.remainingAmount} ${lot.unit}`], url: `/lims/${lot.reagentId}` };
  }
  if (type === 'location') {
    const location = await Location.findOne({ _id: id, isDeleted: false });
    if (!location) fail(404, '항목을 찾을 수 없습니다.');
    return { type, id, title: location.name, detailLines: [location.kind], url: `/locations/${id}` };
  }
  const entity = await Entity.findOne({ _id: id, isDeleted: false });
  if (!entity) fail(404, '항목을 찾을 수 없습니다.');
  if (entity.projectId) await projectAccess(req.user, entity.projectId, false);
  const entityType = await EntityType.findOne({ _id: entity.typeId, isDeleted: false });
  if (!entityType || (type === 'sample' && entityType.kind !== 'sample') || (type === 'equipment' && entityType.kind !== 'equipment')) fail(404, '항목을 찾을 수 없습니다.');
  return { type, id, title: entity.name, detailLines: [entity.code, entityType.name], url: `/entities/${id}` };
}
async function labelList(req) {
  if (!Array.isArray(req.body.items) || req.body.items.length < 1 || req.body.items.length > 500) fail(400, '출력할 라벨 목록을 확인해주세요.');
  const labels = [];
  for (const row of req.body.items) {
    if (!row || typeof row !== 'object' || Object.keys(row).some((key) => !['type','id'].includes(key))) fail(400, '라벨에는 종류와 ID만 지정할 수 있습니다.');
    if (!['reagent','lot','sample','equipment','location'].includes(row.type)) fail(400, '라벨 종류를 확인해주세요.');
    labels.push(await resolveItem(req, row.type, row.id));
  }
  return labels;
}
router.post('/pdf', async (req, res) => {
  const labels = await labelList(req);
  const startOffset = req.body.startOffset ?? 0;
  if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset > 5000) fail(400, '시작 위치를 확인해주세요.');
  const sheet = req.body.sheet;
  if (typeof sheet !== 'string') fail(400, '라벨 시트는 등록된 이름으로 지정해주세요.');
  try { resolveSheetTemplate(sheet); } catch { fail(400, '라벨 시트 종류를 확인해주세요.'); }
  const pdf = await renderSheetPdf(labels, { name: sheet, startOffset, fontBytes: await readFile(fontPath) });
  res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'attachment; filename="labels.pdf"').send(Buffer.from(pdf));
});
router.post('/zpl', async (req, res) => {
  const labels = await labelList(req);
  try { resolveTemplate(req.body.template); } catch { fail(400, '라벨 규격을 확인해주세요.'); }
  const zpl = labels.map((label) => renderZpl(label, req.body.template)).join('\n');
  res.type('text/plain; charset=utf-8').set('Content-Disposition', 'attachment; filename="labels.zpl"').send(zpl);
});
export default router;

export async function resolveScan(req, res) {
  const payload = String(req.query.code || '').trim();
  const decoded = decodeLabel(payload);
  if (decoded.ok) {
    try {
      const item = await resolveItem(req, decoded.type, decoded.id);
      return res.json({ type: item.type, id: item.id, title: item.title, url: item.url });
    } catch { return res.status(404).json({ message: '항목을 찾을 수 없습니다.' }); }
  }
  if (/^[a-f\d]{24}$/i.test(payload)) {
    try {
      const item = await resolveItem(req, 'reagent', payload);
      return res.json({ type: 'reagent', id: item.id, title: item.title, url: item.url });
    } catch { return res.status(404).json({ message: '항목을 찾을 수 없습니다.' }); }
  }
  return res.status(404).json({ message: '항목을 찾을 수 없습니다.' });
}
