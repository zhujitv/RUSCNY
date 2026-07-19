import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { hashPassword, prehashPassword, verifyPassword } from '../src/services/passwords.js';

const pepper = 'test-password-pepper-at-least-32-bytes';

describe('versioned password hashing', () => {
  it('uses every byte beyond bcrypt\'s 72-byte input limit', async () => {
    const commonPrefix = 'a'.repeat(100);
    const first = await hashPassword(`${commonPrefix}-first`, pepper);

    await expect(verifyPassword(`${commonPrefix}-first`, first, pepper)).resolves.toEqual({
      valid: true,
      needsUpgrade: false,
    });
    await expect(verifyPassword(`${commonPrefix}-second`, first, pepper)).resolves.toEqual({
      valid: false,
      needsUpgrade: false,
    });
  });

  it('makes the full pepper affect the pre-hash', () => {
    const sharedPrefix = 'p'.repeat(100);
    expect(prehashPassword('password', `${sharedPrefix}-one`)).not.toBe(
      prehashPassword('password', `${sharedPrefix}-two`),
    );
  });

  it('verifies legacy hashes and flags them for upgrade', async () => {
    const legacyHash = await bcrypt.hash(`legacy-password:${pepper}`, 4);

    await expect(verifyPassword('legacy-password', legacyHash, pepper)).resolves.toEqual({
      valid: true,
      needsUpgrade: true,
    });
    await expect(verifyPassword('wrong-password', legacyHash, pepper)).resolves.toEqual({
      valid: false,
      needsUpgrade: true,
    });
  });
});
