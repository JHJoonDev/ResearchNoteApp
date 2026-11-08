import express from 'express';
import mongoose from 'mongoose';
import LimsItem from '../models/LimsItem.js';
import LimsLot from '../models/LimsLot.js';
import LimsTransaction from '../models/LimsTransaction.js';
import Location from '../models/Location.js';
import { auth, writer } from '../middleware/auth.js';
import { text, objectId, fail, serialize, audit } from '../lib/core.js';
import { locationPath, lotView, parseOptionalDate } from '../lib/lots.js';
import { roundQuantity } from '../lib/quantity.js';
import { enqueueWebhookEvent } from '../lib/webhooks.js';

const router = express.Router();
router.use(auth);

export function itemView(item) {
  const n = serialize(item), today = new Date().toISOString().slice(0, 10);
  if (n.status !== '만료') {
    n.status = '양호';
    if (n.expirationDate && n.expirationDate < today) n.status = '만료';
    else if (n.stockValue <= (n.minimumStock || 0)) n.status = '부족';
    else if (n.expirationDate && new Date(n.expirationDate) - new Date(today) <= 30 * 86400000) n.status = '만료 예정';
  }
  return { ...n, version: n.__v, stock: `${n.stockValue} ${n.unit}` };
}
function itemFields(body, current = {}, creating = false) {
  const allowed = ['name','brand','cas','stockValue','unit','status','location','ghsPictograms','msdsUrl','expirationDate','minimumStock'];
  const data = Object.fromEntries(allowed.map((k) => [k, body[k] ?? current[k]]).filter(([, v]) => v !== undefined));
  data.name = text(data.name, '시약명');
  if (typeof data.stockValue !== 'number' || !Number.isFinite(data.stockValue) || data.stockValue < 0) fail(400, '재고는 0 이상의 숫자여야 합니다.');
  data.stockValue = roundQuantity(data.stockValue);
  if (data.minimumStock !== undefined && (typeof data.minimumStock !== 'number' || !Number.isFinite(data.minimumStock) || data.minimumStock < 0)) fail(400, '최소 재고를 확인해주세요.');
  if (!['L','mL','kg','g','mg','ea'].includes(data.unit)) fail(400, '시약 단위를 확인해주세요.');
  if (data.expirationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(data.expirationDate) || Number.isNaN(Date.parse(data.expirationDate)) || new Date(data.expirationDate).toISOString().slice(0, 10) !== data.expirationDate)) fail(400, '유효기간 형식을 확인해주세요.');
  if (data.msdsUrl && !/^https?:\/\//i.test(data.msdsUrl)) fail(400, 'MSDS 주소는 http 또는 https 주소여야 합니다.');
  for (const key of ['brand','cas','location','msdsUrl']) if (data[key] !== undefined) text(data[key], key, 1000, false);
  if (body.ghsPictograms !== undefined && (!Array.isArray(body.ghsPictograms) || body.ghsPictograms.some((x) => typeof x !== 'string'))) fail(400, 'GHS 표지를 확인해주세요.');
  delete data.status;
  return data;
}
async function syncStock(itemId, session) {
  const [row] = await LimsLot.aggregate([{ $match: { reagentId: new mongoose.Types.ObjectId(String(itemId)), isDeleted: false } }, { $group: { _id: null, total: { $sum: '$remainingAmount' } } }]).session(session);
  const stockValue = roundQuantity(row?.total || 0);
  const item = await LimsItem.findById(itemId).session(session);
  if (!item) fail(404, '시약을 찾을 수 없습니다.');
  item.stockValue = stockValue; item.__v += 1; await item.save({ session });
  return item;
}
function transactionType(amount, supplied) { return supplied || (amount > 0 ? '입고' : '폐기'); }
function derivedLotStatus(lot, requested = undefined) {
  if (requested === '폐기' || (requested === undefined && lot.status === '폐기')) return '폐기';
  if (lot.expirationDate && new Date(lot.expirationDate).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) return '만료';
  if (lot.remainingAmount <= 0) return '소진';
  return '사용가능';
}
async function ensureLocation(id, session) {
  if (!id) return { id: null, path: '' };
  const validId = objectId(id);
  const path = await locationPath(validId, session);
  return { id: validId, path };
}

router.get('/', async (req, res) => res.json((await LimsItem.find({ isDeleted: false }).sort({ updatedAt: -1 })).map(itemView)));
router.post('/', writer, async (req, res) => {
  const data = itemFields(req.body, {}, true);
  const requestedLot = req.body.lotNumber === undefined ? `INITIAL-${new Date().toISOString().slice(0,10).replaceAll('-','')}` : text(req.body.lotNumber, '로트 번호', 100);
  let item;
  await mongoose.connection.transaction(async (session) => {
    [item] = await LimsItem.create([{ ...data, stockValue: 0 }], { session });
    const amount = roundQuantity(data.stockValue);
    const expirationDate = parseOptionalDate(data.expirationDate, '유효기간');
    await LimsLot.create([{ reagentId: item._id, lotNumber: requestedLot, initialAmount: amount, remainingAmount: amount, unit: item.unit, expirationDate, status: derivedLotStatus({ remainingAmount: amount, expirationDate }), receivedAt: new Date(), location: data.location || '미지정' }], { session });
    item.stockValue = roundQuantity(amount); item.__v += 1; await item.save({ session });
    if (amount > 0) await LimsTransaction.create([{ reagentId: item._id, lotId: (await LimsLot.findOne({ reagentId: item._id, lotNumber: requestedLot }).session(session))._id, lotNumber: requestedLot, reagentName: item.name, userId: req.user.id, userName: req.user.name, type: '입고', amount, unit: item.unit, remarks: '최초 입고' }], { session });
    await audit(req, 'CREATE', 'LIMS', item, null, session);
  });
  res.status(201).json(itemView(item));
});
router.put('/:id', writer, async (req, res) => {
  const id = objectId(req.params.id); let item;
  await mongoose.connection.transaction(async (session) => {
    item = await LimsItem.findOne({ _id: id, isDeleted: false }).session(session);
    if (!item) fail(404, '시약을 찾을 수 없습니다.');
    if (!Number.isInteger(req.body.version) || req.body.version !== item.__v) fail(409, '재고가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
    const before = item.toObject();
    const data = itemFields({ ...req.body, stockValue: req.body.stockValue ?? item.stockValue }, before);
    if (req.body.stockValue !== undefined && data.stockValue !== item.stockValue) fail(409, '재고 직접 수정은 지원하지 않습니다. 로트에서 조정해주세요.');
    if (data.unit !== item.unit) fail(400, '기록이 있는 시약의 단위는 변경할 수 없습니다. 새 시약으로 등록해주세요.');
    Object.assign(item, data); item.__v += 1; await item.save({ session });
    await audit(req, 'UPDATE', 'LIMS', item, before, session);
  });
  res.json(itemView(item));
});
router.delete('/:id', writer, async (req, res) => {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const item = await LimsItem.findOne({ _id: id, isDeleted: false }).session(session);
    if (!item) fail(404, '시약을 찾을 수 없습니다.');
    if (req.body.version !== item.__v) fail(409, '시약 정보가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
    const before = item.toObject(); item.isDeleted = true; item.__v += 1; await item.save({ session}); await audit(req, 'DELETE', 'LIMS', item, before, session);
  });
  res.json({ success: true });
});
router.get('/:id/lots', async (req, res) => {
  const id = objectId(req.params.id);
  if (!(await LimsItem.exists({ _id: id, isDeleted: false }))) fail(404, '시약을 찾을 수 없습니다.');
  res.json((await LimsLot.find({ reagentId: id, isDeleted: false }).sort({ expirationDate: 1, receivedAt: 1, _id: 1 }).lean()).map(lotView));
});
router.post('/:id/lots', writer, async (req, res) => {
  const id = objectId(req.params.id); let lot;
  await mongoose.connection.transaction(async (session) => {
    const item = await LimsItem.findOne({ _id: id, isDeleted: false }).session(session); if (!item) fail(404, '시약을 찾을 수 없습니다.');
    const lotNumber = text(req.body.lotNumber, '로트 번호', 100);
    const amount = roundQuantity(req.body.amount);
    if (typeof req.body.amount !== 'number' || !Number.isFinite(req.body.amount) || amount <= 0) fail(400, '입고량은 0보다 큰 숫자여야 합니다.');
    const loc = await ensureLocation(req.body.locationId, session);
    const suppliedLocation = req.body.location === undefined ? (loc.id ? loc.path : item.location || '미지정') : text(req.body.location, '보관 위치', 1000, false);
    const expirationDate = parseOptionalDate(req.body.expirationDate, '유효기간');
    const receivedAt = parseOptionalDate(req.body.receivedAt, '입고일') || new Date();
    [lot] = await LimsLot.create([{ reagentId: id, lotNumber, supplierLot: req.body.supplierLot === undefined ? '' : text(req.body.supplierLot, '공급업체 로트', 200, false), initialAmount: amount, remainingAmount: amount, unit: item.unit, expirationDate, status: derivedLotStatus({ remainingAmount: amount, expirationDate }), receivedAt, locationId: loc.id, location: loc.id ? loc.path : suppliedLocation }], { session });
    const updated = await syncStock(item._id, session);
    if (item.stockValue > (item.minimumStock || 0) && updated.stockValue <= (item.minimumStock || 0)) await enqueueWebhookEvent('reagent.low_stock', { reagentId: String(item._id), name: item.name, stockValue: updated.stockValue, minimumStock: item.minimumStock || 0, unit: item.unit }, session);
    await LimsTransaction.create([{ reagentId: id, lotId: lot._id, lotNumber, reagentName: item.name, userId: req.user.id, userName: req.user.name, type: '입고', amount, unit: item.unit, remarks: '로트 입고' }], { session });
    await audit(req, 'LOT_RECEIVE', 'LIMS', updated, item.toObject(), session);
  });
  res.status(201).json(lotView(lot));
});
router.put('/lots/:lotId', writer, async (req, res) => {
  const id = objectId(req.params.lotId); let lot;
  await mongoose.connection.transaction(async (session) => {
    lot = await LimsLot.findOne({ _id: id, isDeleted: false }).session(session); if (!lot) fail(404, '로트를 찾을 수 없습니다.');
    if (!Number.isInteger(req.body.version) || req.body.version !== lot.__v) fail(409, '로트 정보가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
    const before = lot.toObject();
    if (req.body.status !== undefined) {
      if (!['사용가능', '폐기'].includes(req.body.status)) fail(400, '로트 상태는 사용가능 또는 폐기만 직접 지정할 수 있습니다.');
    }
    if (req.body.locationId !== undefined) {
      const loc = await ensureLocation(req.body.locationId, session); lot.locationId = loc.id;
      lot.location = loc.id ? loc.path : (req.body.location === undefined ? '미지정' : text(req.body.location, '보관 위치', 1000, false));
    } else if (req.body.location !== undefined) { lot.locationId = null; lot.location = text(req.body.location, '보관 위치', 1000, false); }
    if (req.body.expirationDate !== undefined) lot.expirationDate = parseOptionalDate(req.body.expirationDate, '유효기간');
    lot.initialAmount = roundQuantity(lot.initialAmount);
    lot.remainingAmount = roundQuantity(lot.remainingAmount);
    lot.status = derivedLotStatus(lot, req.body.status);
    lot.__v += 1; await lot.save({ session }); await audit(req, 'LOT_UPDATE', 'LIMS_LOT', lot, before, session);
  });
  res.json(lotView(lot));
});
router.post('/lots/:lotId/adjust', writer, async (req, res) => {
  const id = objectId(req.params.lotId), delta = roundQuantity(req.body.delta);
  if (typeof req.body.delta !== 'number' || !Number.isFinite(req.body.delta) || delta === 0) fail(400, '재고 조정량은 0이 아닌 숫자여야 합니다.');
  const reason = text(req.body.reason, '조정 사유', 1000);
  let result;
  await mongoose.connection.transaction(async (session) => {
    const lot = await LimsLot.findOne({ _id: id, isDeleted: false }).session(session); if (!lot) fail(404, '로트를 찾을 수 없습니다.');
    if (!Number.isInteger(req.body.version) || req.body.version !== lot.__v) fail(409, '로트 정보가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
    const item = await LimsItem.findOne({ _id: lot.reagentId, isDeleted: false }).session(session); if (!item) fail(404, '시약을 찾을 수 없습니다.');
    const next = roundQuantity(lot.remainingAmount + delta); if (next < 0) fail(409, '로트 잔량보다 많이 차감할 수 없습니다.');
    if (delta > 0 && lot.status !== '사용가능') fail(409, '사용 가능한 상태의 로트만 입고 조정할 수 있습니다.');
    const before = lot.toObject(); lot.remainingAmount = next; lot.status = derivedLotStatus(lot); lot.__v += 1; await lot.save({ session });
    result = await syncStock(item._id, session);
    if (item.stockValue > (item.minimumStock || 0) && result.stockValue <= (item.minimumStock || 0)) await enqueueWebhookEvent('reagent.low_stock', { reagentId: String(item._id), name: item.name, stockValue: result.stockValue, minimumStock: item.minimumStock || 0, unit: item.unit }, session);
    await LimsTransaction.create([{ reagentId: item._id, lotId: lot._id, lotNumber: lot.lotNumber, reagentName: item.name, userId: req.user.id, userName: req.user.name, type: transactionType(delta), amount: roundQuantity(Math.abs(delta)), unit: item.unit, remarks: reason }], { session });
    await audit(req, 'LOT_ADJUST', 'LIMS_LOT', lot, before, session, reason);
  });
  res.json(itemView(result));
});
router.get('/:id/transactions', async (req, res) => res.json(await LimsTransaction.find({ reagentId: objectId(req.params.id) }).sort({ createdAt: -1 })));
export default router;
