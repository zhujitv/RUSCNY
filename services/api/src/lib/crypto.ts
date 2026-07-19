import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export const randomRoomCode = () => {
  const value = randomBytes(4).readUInt32BE(0) % 100_000_000;
  return value.toString().padStart(8, '0');
};

export const stableHash = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const secretHash = (value: string, pepper: string) =>
  stableHash(`${pepper}:${value}`);

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
