import { decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/lib/tokens.js';

const encoder = new TextEncoder();

describe('access tokens', () => {
  it('round-trips the security-relevant claims', async () => {
    const token = await signAccessToken({
      subjectId: 'user-a',
      role: 'USER',
      deviceId: 'ios-device-a',
      sessionId: 'session-a',
    });

    await expect(verifyAccessToken(token)).resolves.toMatchObject({
      subjectId: 'user-a',
      role: 'USER',
      deviceId: 'ios-device-a',
      sessionId: 'session-a',
    });
  });

  it('normalizes pre-migration Host and Customer claims to the unified user role', async () => {
    for (const legacyRole of ['HOST', 'CUSTOMER']) {
      const token = await new SignJWT({
        role: legacyRole,
        deviceId: 'legacy-device-a',
        sessionId: 'legacy-session-a',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('legacy-user-a')
        .setExpirationTime('5m')
        .sign(encoder.encode(config.JWT_ACCESS_SECRET));
      await expect(verifyAccessToken(token)).resolves.toMatchObject({
        subjectId: 'legacy-user-a',
        role: 'USER',
      });
    }
  });

  it('binds guest credentials to a concrete identity session', async () => {
    const token = await signAccessToken({
      subjectId: 'guest-a',
      role: 'GUEST',
      deviceId: 'guest-device-a',
      sessionId: 'guest-session-a',
      guestIdentityId: 'guest-a',
      conversationId: 'conversation-a',
    });

    await expect(verifyAccessToken(token)).resolves.toMatchObject({
      subjectId: 'guest-a',
      role: 'GUEST',
      deviceId: 'guest-device-a',
      sessionId: 'guest-session-a',
      guestIdentityId: 'guest-a',
      conversationId: 'conversation-a',
    });
    await expect(
      signAccessToken({
        subjectId: 'guest-a',
        role: 'GUEST',
        deviceId: 'guest-device-a',
        guestIdentityId: 'guest-a',
        conversationId: 'conversation-a',
      }),
    ).rejects.toThrow('requires a session');
    const payload = decodeJwt(token);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(
      config.ACCESS_TOKEN_TTL_SECONDS,
    );
  });

  it('rejects a correctly signed token after it expires', async () => {
    const expired = await new SignJWT({ role: 'USER', deviceId: 'device-a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-a')
      .setIssuedAt(Math.floor(Date.now() / 1_000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1_000) - 1)
      .sign(encoder.encode(config.JWT_ACCESS_SECRET));

    await expect(verifyAccessToken(expired)).rejects.toMatchObject({
      statusCode: 401,
      code: 'TOKEN_INVALID',
    });
  });

  it('rejects tokens with an invalid signature or incomplete claims', async () => {
    const wrongSignature = await new SignJWT({ role: 'USER', deviceId: 'device-a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-a')
      .setExpirationTime('5m')
      .sign(encoder.encode('a-different-secret-that-is-long-enough'));
    await expect(verifyAccessToken(wrongSignature)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });

    const missingRole = await new SignJWT({ deviceId: 'device-a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-a')
      .setExpirationTime('5m')
      .sign(encoder.encode(config.JWT_ACCESS_SECRET));
    await expect(verifyAccessToken(missingRole)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });
});

describe('refresh tokens', () => {
  it('round-trips device and rotation identifiers', async () => {
    const token = await signRefreshToken({
      userId: 'user-a',
      deviceId: 'android-device-a',
      sessionId: 'session-a',
      familyId: 'session-a',
      jti: 'rotation-a',
    });
    await expect(verifyRefreshToken(token)).resolves.toEqual({
      userId: 'user-a',
      deviceId: 'android-device-a',
      sessionId: 'session-a',
      familyId: 'session-a',
      jti: 'rotation-a',
    });
  });

  it('does not accept an access token as a refresh token', async () => {
    const accessToken = await signAccessToken({
      subjectId: 'user-a',
      role: 'USER',
      deviceId: 'ios-device-a',
      sessionId: 'session-a',
    });
    await expect(verifyRefreshToken(accessToken)).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_INVALID',
    });
  });

  it('rejects legacy refresh tokens that are not bound to a login family', async () => {
    const legacy = await new SignJWT({ type: 'refresh', deviceId: 'android-device-a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-a')
      .setJti('legacy-rotation')
      .setExpirationTime('5m')
      .sign(encoder.encode(config.JWT_REFRESH_SECRET));

    await expect(verifyRefreshToken(legacy)).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_INVALID',
    });
  });
});
