import mongoose from 'mongoose';
import LimsItem from '../models/LimsItem.js';
import LimsLot from '../models/LimsLot.js';
import LimsTransaction from '../models/LimsTransaction.js';
import { fail, objectId, audit } from './core.js';
import { lotUsable } from './lots.js';
import { enqueueWebhookEvent } from './webhooks.js';
import { roundQuantity } from './quantity.js';

function plain(value) { return value?.toObject ? value.toObject() : value; }
function amount(value) {
  return Number.isFinite(value) && value > 0;
}
function add(map, lotId, value) { map.set(String(lotId), roundQuantity((map.get(String(lotId)) || 0) + value)); }
function allocationsFor(reagent) {
  const r = plain(reagent);
  if (Array.isArray(r.allocations) && r.allocations.length) return r.allocations.map((a) => ({ lotId: String(a.lotId), lotNumber: a.lotNumber, amount: a.amount }));
  return [];
}

export async function adjustReagents(req, note, previous, supplied, session) {
  if (!Array.isArray(supplied) || supplied.length > 100) fail(400, '시약 사용 목록을 확인해주세요.');
  const old = new Map((previous || []).map((r) => [String(plain(r).reagentId), plain(r)]));
  const next = new Map();
  for (const raw of supplied) {
    if (!raw || typeof raw !== 'object') fail(400, '시약 사용 정보를 확인해주세요.');
    const id = objectId(typeof raw.reagentId === 'string' ? raw.reagentId : String(raw.reagentId || ''));
    const normalizedAmount = roundQuantity(raw.amount);
    if (next.has(id) || !amount(normalizedAmount)) fail(400, '시약 사용량은 양수여야 하며 같은 시약을 중복할 수 없습니다.');
    next.set(id, { ...raw, amount: normalizedAmount, reagentId: id, lotId: raw.lotId ? objectId(raw.lotId) : null });
  }
  const results = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const beforeUsage = old.get(id), after = next.get(id);
    const item = await LimsItem.findById(id).session(session);
    if (!item || item.isDeleted) fail(400, '삭제되었거나 존재하지 않는 시약입니다.');
    if (after && after.unit !== item.unit) fail(400, '시약 단위가 일치하지 않습니다.');
    const previousAmount = roundQuantity(beforeUsage?.amount || 0);
    const previousAllocations = allocationsFor(beforeUsage || {});
    const oldByLot = new Map();
    for (const allocation of previousAllocations) add(oldByLot, allocation.lotId, allocation.amount);

    // Legacy notes are associated with their migration lot so edits can return stock to its source lot.
    if (previousAmount > 0 && oldByLot.size === 0) {
      const legacyId = `LEGACY-${id}`;
      const legacy = await LimsLot.findOne({ reagentId: id, lotNumber: legacyId, isDeleted: false }).session(session)
        || await LimsLot.findOne({ reagentId: id, isDeleted: false }).sort({ receivedAt: 1, _id: 1 }).session(session);
      if (!legacy) fail(409, `${item.name}: 이전 사용량을 복원할 로트가 없습니다.`);
      oldByLot.set(String(legacy._id), previousAmount);
    }

    let newAllocations = [];
    if (after) {
      let needed = after.amount;
      if (!after.lotId) {
        // Keep existing allocations when reducing or extending a usage; only allocate the difference.
        for (const oldAllocation of previousAllocations) {
          if (needed <= 0) break;
          const retained = roundQuantity(Math.min(needed, oldAllocation.amount));
          if (retained > 0) newAllocations.push({ lotId: oldAllocation.lotId, lotNumber: oldAllocation.lotNumber, amount: retained });
          needed = roundQuantity(needed - retained);
        }
        if (previousAmount > 0 && previousAllocations.length === 0) {
          const [legacyId, legacyAmount] = oldByLot.entries().next().value;
          const lot = await LimsLot.findById(legacyId).session(session);
          const retained = roundQuantity(Math.min(needed, legacyAmount));
          if (retained > 0) newAllocations.push({ lotId: legacyId, lotNumber: lot.lotNumber, amount: retained });
          needed = roundQuantity(needed - retained);
        }
      } else {
        const target = await LimsLot.findOne({ _id: after.lotId, reagentId: id, isDeleted: false }).session(session);
        if (!target) fail(400, '선택한 로트가 시약에 속하지 않습니다.');
        const existingOnTarget = previousAllocations.length && previousAllocations.every((a) => a.lotId === String(target._id))
          ? roundQuantity(previousAllocations.reduce((sum, a) => sum + a.amount, 0)) : 0;
        const retained = roundQuantity(Math.min(needed, existingOnTarget));
        if (retained > 0) newAllocations.push({ lotId: String(target._id), lotNumber: target.lotNumber, amount: retained });
        needed = roundQuantity(needed - retained);
      }

      if (needed > 0) {
        const ordered = after.lotId
          ? await LimsLot.find({ _id: after.lotId, reagentId: id, isDeleted: false }).session(session)
          : await LimsLot.find({ reagentId: id, isDeleted: false }).sort({ expirationDate: 1, receivedAt: 1, _id: 1 }).session(session);
        for (const lot of ordered) {
          if (!lotUsable(lot)) continue;
          const existingUsed = newAllocations.filter((a) => a.lotId === String(lot._id)).reduce((sum, a) => sum + a.amount, 0);
          const restored = oldByLot.get(String(lot._id)) || 0;
          const available = roundQuantity(lot.remainingAmount + restored - existingUsed);
          if (available <= 0) continue;
          const take = roundQuantity(Math.min(available, needed));
          if (take > 0) {
            const existing = newAllocations.find((a) => a.lotId === String(lot._id));
            if (existing) existing.amount = roundQuantity(existing.amount + take);
            else newAllocations.push({ lotId: String(lot._id), lotNumber: lot.lotNumber, amount: take });
            needed = roundQuantity(needed - take);
          }
          if (needed <= 0) break;
        }
        if (needed > 0) fail(409, `${item.name}: 사용 가능한 로트 재고가 부족합니다.`);
      }
    }

    const newByLot = new Map();
    for (const allocation of newAllocations) add(newByLot, allocation.lotId, allocation.amount);
    const allLotIds = new Set([...oldByLot.keys(), ...newByLot.keys()]);
    for (const lotId of allLotIds) {
      const delta = roundQuantity((oldByLot.get(lotId) || 0) - (newByLot.get(lotId) || 0)); // positive returns stock
      if (!delta) continue;
      const lot = await LimsLot.findOne({ _id: objectId(lotId), reagentId: id, isDeleted: false }).session(session);
      if (!lot) fail(409, '사용 기록의 로트를 찾을 수 없습니다.');
      const remainingAmount = roundQuantity(lot.remainingAmount + delta);
      const update = await LimsLot.updateOne(
        { _id: lot._id, isDeleted: false, ...(delta < 0 ? { remainingAmount: { $gte: -delta } } : {}) },
        {
          $inc: { __v: 1 },
          $set: { remainingAmount, status: lot.status === '폐기' ? '폐기' : (lot.expirationDate && new Date(lot.expirationDate).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10) ? '만료' : remainingAmount <= 0 ? '소진' : '사용가능') },
        }, { session },
      );
      if (!update.modifiedCount) fail(409, `${item.name}: 로트 재고가 변경되었거나 부족합니다.`);
      await LimsTransaction.create([{
        reagentId: id, lotId: lot._id, lotNumber: lot.lotNumber, reagentName: item.name,
        userId: req.user.id, userName: req.user.name, type: delta < 0 ? '소모' : '조정',
        amount: roundQuantity(Math.abs(delta)), unit: item.unit, noteId: note._id, noteTitle: note.title,
        remarks: delta < 0 ? '노트 시약 사용' : '노트 사용량 수정에 따른 로트 반환',
      }], { session });
    }
    const [sumRow] = await LimsLot.aggregate([
      { $match: { reagentId: new mongoose.Types.ObjectId(id), isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$remainingAmount' } } },
    ]).session(session);
    const synced = await LimsItem.findOneAndUpdate(
      { _id: item._id, isDeleted: false },
      { $set: { stockValue: roundQuantity(sumRow?.total || 0) }, $inc: { __v: 1 } },
      { returnDocument: 'after', session },
    );
    if (item.stockValue > (item.minimumStock || 0) && synced.stockValue <= (item.minimumStock || 0)) {
      await enqueueWebhookEvent('reagent.low_stock', { reagentId: String(item._id), name: item.name, stockValue: synced.stockValue, minimumStock: item.minimumStock || 0, unit: item.unit }, session);
    }
    await audit(req, 'UPDATE', 'LIMS', synced, item.toObject(), session);
    if (after) results.push({ reagentId: id, name: item.name, unit: item.unit, amount: after.amount, allocations: newAllocations });
  }
  return results;
}
