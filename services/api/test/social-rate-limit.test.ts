import { describe, expect, it } from 'vitest';
import { subjectCredentialRateLimit } from '../src/routes/social.js';

describe('social credential rate-limit key', () => {
  it('canonicalizes whitespace accepted by Bearer authentication', () => {
    const keyGenerator = subjectCredentialRateLimit(10).keyGenerator;

    const canonical = keyGenerator({
      headers: { authorization: 'Bearer access-token' },
      ip: '192.0.2.1',
    });
    const padded = keyGenerator({
      headers: { authorization: 'Bearer access-token   ' },
      ip: '192.0.2.2',
    });

    expect(padded).toBe(canonical);
    expect(canonical).not.toBe('192.0.2.1');
  });

  it('uses the IP bucket for malformed credentials', () => {
    const keyGenerator = subjectCredentialRateLimit(10).keyGenerator;
    expect(keyGenerator({
      headers: { authorization: 'Basic access-token' },
      ip: '192.0.2.1',
    })).toBe('192.0.2.1');
  });
});
