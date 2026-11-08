import Location from '../models/Location.js';
import { fail, objectId } from './core.js';

export function parseOptionalDate(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(400, `${name} 날짜를 확인해주세요.`);
  return date;
}

export async function locationPath(id, session = null) {
  if (!id) return '';
  const parts = [];
  const seen = new Set();
  let currentId = objectId(String(id));
  while (currentId) {
    if (seen.has(String(currentId))) fail(409, '위치 경로에 순환이 있습니다.');
    seen.add(String(currentId));
    const location = await Location.findOne({ _id: currentId, isDeleted: false }).select('name parentId').session(session);
    if (!location) fail(400, '보관 위치를 찾을 수 없습니다.');
    parts.unshift(location.name);
    currentId = location.parentId;
  }
  return parts.join(' / ');
}

export function lotView(lot) {
  const value = lot.toObject ? lot.toObject() : lot;
  return {
    id: String(value._id), reagentId: String(value.reagentId), lotNumber: value.lotNumber,
    supplierLot: value.supplierLot || '', initialAmount: value.initialAmount,
    remainingAmount: value.remainingAmount, unit: value.unit,
    expirationDate: value.expirationDate || null, receivedAt: value.receivedAt || null,
    status: value.status, locationId: value.locationId ? String(value.locationId) : null,
    location: value.location || '', version: value.__v || 0,
  };
}

export function lotUsable(lot, now = new Date()) {
  return !lot.isDeleted && lot.status === '사용가능' && lot.remainingAmount > 0 &&
    (!lot.expirationDate || new Date(lot.expirationDate) >= new Date(now.toISOString().slice(0, 10)));
}
