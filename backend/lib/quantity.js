const QUANTITY_SCALE = 1_000_000;

export function roundQuantity(value) {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round((value + Math.sign(value) * Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;
  return rounded === 0 ? 0 : rounded;
}
