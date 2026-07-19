import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    guestIdentity: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));

import { validateAuthContext } from '../src/auth.js';
import { signAccessToken, verifyAccessToken } from '../src/lib/tokens.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('server-side auth session validation', () => {
  it('keeps a logged-out guest token invalid after rejoin while accepting the new token', async () => {
    const oldToken = await signAccessToken({
      subjectId: 'guest-a',
      role: 'GUEST',
      deviceId: 'guest-device-a',
      sessionId: 'guest-session-old',
      guestIdentityId: 'guest-a',
      conversationId: 'conversation-a',
    });
    const newToken = await signAccessToken({
      subjectId: 'guest-a',
      role: 'GUEST',
      deviceId: 'guest-device-a',
      sessionId: 'guest-session-new',
      guestIdentityId: 'guest-a',
      conversationId: 'conversation-a',
    });
    const oldClaims = await verifyAccessToken(oldToken);
    const newClaims = await verifyAccessToken(newToken);

    mocks.prisma.guestIdentity.findUnique.mockResolvedValueOnce({
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1),
      conversationId: 'conversation-a',
      sessionId: 'guest-session-old',
    });
    await expect(validateAuthContext(oldClaims)).rejects.toMatchObject({
      statusCode: 401,
      code: 'GUEST_TOKEN_REVOKED',
    });

    mocks.prisma.guestIdentity.findUnique.mockResolvedValue({
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      conversationId: 'conversation-a',
      sessionId: 'guest-session-new',
    });
    await expect(validateAuthContext(oldClaims)).rejects.toMatchObject({
      statusCode: 401,
      code: 'GUEST_TOKEN_REVOKED',
    });
    await expect(validateAuthContext(newClaims)).resolves.toBeUndefined();
  });
});
