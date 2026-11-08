const timestampLabels = {
  not_configured: '미설정',
  pending: '요청 중',
  granted: '완료',
  failed: '실패',
};

function plainDecimal(value) {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponentText] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const sign = coefficient.startsWith('-') ? '-' : '';
  const unsigned = sign ? coefficient.slice(1) : coefficient;
  const point = unsigned.indexOf('.') === -1 ? unsigned.length : unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const nextPoint = point + exponent;
  if (nextPoint <= 0) return `${sign}0.${'0'.repeat(-nextPoint)}${digits}`;
  if (nextPoint >= digits.length) return `${sign}${digits}${'0'.repeat(nextPoint - digits.length)}`;
  return `${sign}${digits.slice(0, nextPoint)}.${digits.slice(nextPoint)}`;
}

export function formatQuantity(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (Object.is(number, -0)) return '0';

  // Snap only values less than one relative machine epsilon from a
  // 12-significant-digit decimal. Higher precision values remain untouched.
  const compact = Number(number.toPrecision(12));
  const tolerance = Number.EPSILON * Math.abs(number) * 0.99;
  return plainDecimal(Math.abs(number - compact) < tolerance ? compact : number);
}

export function formatTimestampStatus(timestamp, additionallyUntrusted = false) {
  const status = timestamp?.status;
  const label = timestampLabels[status] || (status ? '알 수 없음' : '미제공');
  const untrusted = status === 'not_configured'
    || timestamp?.isTrusted === false
    || timestamp?.provider === 'dev-local'
    || additionallyUntrusted;
  return untrusted ? `${label} (공인 시점인증 아님)` : label;
}
