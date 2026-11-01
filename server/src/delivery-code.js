import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const CODE_TTL_MS = 30 * 60 * 1000;

function codeSecret() {
  return process.env.DELIVERY_CODE_SECRET || process.env.JWT_SECRET || 'local-development-secret-change-before-deploying';
}

export function newDeliveryCode(orderId) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  return { code, hash: hashDeliveryCode(orderId, code), expiresAt };
}

export function hashDeliveryCode(orderId, code) {
  return createHmac('sha256', codeSecret()).update(`${orderId}:${String(code)}`).digest('hex');
}

export function matchesDeliveryCode(orderId, code, storedHash) {
  if (!storedHash || !/^\d{6}$/.test(String(code || ''))) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashDeliveryCode(orderId, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function deliveryCodeExpired(expiresAt) {
  return !expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now();
}
