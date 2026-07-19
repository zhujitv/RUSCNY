import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';

const VERSION_PREFIX = 'v2:';
const BCRYPT_COST = 12;

/**
 * bcrypt only considers the first 72 input bytes. Pre-hashing with a keyed
 * HMAC makes every byte of the password and pepper affect a fixed-size value
 * before bcrypt sees it. The explicit prefix lets us verify and upgrade the
 * legacy `password:pepper` representation without locking existing users out.
 */
export function prehashPassword(password: string, pepper: string): string {
  return createHmac('sha256', pepper)
    .update('translator-password-v2\0', 'utf8')
    .update(password, 'utf8')
    .digest('base64url');
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  const digest = prehashPassword(password, pepper);
  return `${VERSION_PREFIX}${await bcrypt.hash(digest, BCRYPT_COST)}`;
}

export interface PasswordVerification {
  valid: boolean;
  needsUpgrade: boolean;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  pepper: string,
): Promise<PasswordVerification> {
  if (storedHash.startsWith(VERSION_PREFIX)) {
    const bcryptHash = storedHash.slice(VERSION_PREFIX.length);
    if (!bcryptHash.startsWith('$2')) return { valid: false, needsUpgrade: false };
    return {
      valid: await bcrypt.compare(prehashPassword(password, pepper), bcryptHash),
      needsUpgrade: false,
    };
  }

  // Compatibility with hashes created before the versioned HMAC pre-hash was
  // introduced. A successful login replaces this value with the v2 format.
  return {
    valid: await bcrypt.compare(`${password}:${pepper}`, storedHash),
    needsUpgrade: true,
  };
}
