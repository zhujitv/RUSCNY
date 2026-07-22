import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => {
  const state = { role: 'USER' as 'USER' | 'GUEST' };
  const transaction = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    user: { updateMany: vi.fn() },
    userDevice: { findMany: vi.fn(), updateMany: vi.fn() },
    userPasswordResetToken: { updateMany: vi.fn() },
    adminPasswordResetToken: { updateMany: vi.fn() },
  };
  return {
    state,
    transaction,
    verifyPassword: vi.fn(),
    hashPassword: vi.fn(),
    disconnectDevice: vi.fn(),
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)),
      user: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn(),
      },
      userDevice: { findMany: vi.fn(), updateMany: vi.fn() },
      systemSetting: { findUnique: vi.fn() },
    },
  };
});

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));
vi.mock('../src/auth.js', () => ({
  authenticate: async (request: { auth?: unknown }) => {
    request.auth = {
      subjectId: 'user-a',
      role: mocks.state.role,
      deviceId: 'device-current',
      sessionId: 'session-current',
    };
  },
}));
vi.mock('../src/services/passwords.js', () => ({
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hashPassword,
}));
vi.mock('../src/realtime-hub.js', () => ({
  realtimeHub: () => ({
    disconnectDevice: mocks.disconnectDevice,
    disconnectSubject: vi.fn(),
    disconnectParticipant: vi.fn(),
    emitToConversation: vi.fn(),
    emitToSubject: vi.fn(),
    isSubjectOnline: async () => false,
    isReady: () => true,
  }),
}));
vi.mock('../src/services/audio-assets.js', () => ({
  playableAudioUrl: (value: string | null) => value,
}));

import { AppError } from '../src/errors.js';
import { config } from '../src/config.js';
import { registerAuthRoutes } from '../src/routes/auth.js';

let app: FastifyInstance | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.role = 'USER';
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.transaction) => unknown) => callback(mocks.transaction),
  );
  mocks.prisma.systemSetting.findUnique.mockResolvedValue(null);
  mocks.prisma.user.findUnique.mockResolvedValue({
    status: 'ACTIVE',
    passwordHash: 'v2:current-password-hash',
  });
  mocks.verifyPassword.mockResolvedValue({ valid: true, needsUpgrade: false });
  mocks.hashPassword.mockResolvedValue('v2:new-password-hash');
  mocks.transaction.user.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.$queryRaw.mockResolvedValue([{
    id: 'device-row-current',
    userId: 'user-a',
    deviceId: 'device-current',
    sessionId: 'session-current',
    authenticatedAt: new Date('2026-07-22T10:00:00.000Z'),
    revokedAt: null,
    pushToken: null,
    pushBindingId: null,
  }]);
  mocks.transaction.$executeRaw.mockResolvedValue(1);
  mocks.transaction.userDevice.findMany.mockResolvedValue([
    { deviceId: 'device-b' },
    { deviceId: 'device-c' },
  ]);
  mocks.transaction.userDevice.updateMany.mockResolvedValue({ count: 2 });
  mocks.transaction.userPasswordResetToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.adminPasswordResetToken.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.user.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.userDevice.findMany.mockResolvedValue([]);
  mocks.prisma.userDevice.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function createApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  instance.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof AppError) {
      await reply.code(error.statusCode).send({ ok: false, code: error.code });
      return;
    }
    if (error instanceof ZodError) {
      await reply.code(400).send({ ok: false, code: 'VALIDATION_ERROR' });
      return;
    }
    throw error;
  });
  await registerAuthRoutes(instance);
  return instance;
}

describe('personal account management', () => {
  it('changes the password with CAS and revokes every other device', async () => {
    app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/change',
      payload: {
        currentPassword: 'current-password',
        newPassword: 'different-password',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.revokedOtherDeviceCount).toBe(2);
    expect(mocks.transaction.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-a',
        status: 'ACTIVE',
        passwordHash: 'v2:current-password-hash',
      },
      data: { passwordHash: 'v2:new-password-hash' },
    });
    expect(mocks.transaction.userDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deviceId: { not: 'device-current' } }),
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
          refreshTokenHash: null,
          refreshTokenJti: null,
          pushToken: null,
          pushBindingId: null,
          pushTokenUpdatedAt: null,
        }),
      }),
    );
    expect(mocks.disconnectDevice).toHaveBeenCalledTimes(2);
    expect(mocks.disconnectDevice).toHaveBeenCalledWith('user-a', 'device-b');
    expect(mocks.disconnectDevice).toHaveBeenCalledWith('user-a', 'device-c');
  });

  it('does not write or revoke sessions when the current password is wrong', async () => {
    mocks.verifyPassword.mockResolvedValue({ valid: false, needsUpgrade: false });
    app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/change',
      payload: {
        currentPassword: 'wrong-password',
        newPassword: 'different-password',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('INVALID_CURRENT_PASSWORD');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.disconnectDevice).not.toHaveBeenCalled();
  });

  it('persists only allowlisted avatar and account preferences', async () => {
    const user = {
      id: 'user-a',
      role: 'USER',
      displayName: '王伟',
      email: 'wang@example.test',
      phone: null,
      company: '中方项目组',
      preferredLanguage: 'zh',
      avatarUrl: null,
      avatarPreset: 'ocean',
      interfaceLanguage: 'ru',
      autoPlayTranslationAudio: false,
      translationPlaybackSpeed: 1.25,
    };
    mocks.prisma.user.findUniqueOrThrow.mockResolvedValue(user);
    app = await createApp();

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/profile',
      payload: {
        avatarPreset: 'ocean',
        interfaceLanguage: 'ru',
        autoPlayTranslationAudio: false,
        translationPlaybackSpeed: 1.25,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-a', status: 'ACTIVE' },
      data: {
        avatarPreset: 'ocean',
        interfaceLanguage: 'ru',
        autoPlayTranslationAudio: false,
        translationPlaybackSpeed: 1.25,
      },
    });
    expect(response.json().data).toMatchObject({ avatarPreset: 'ocean' });
  });

  it('rejects unknown avatar presets before persistence', async () => {
    app = await createApp();

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/auth/profile',
      payload: { avatarPreset: 'remote-script' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
    expect(mocks.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('lists account devices and marks the authenticated browser as current', async () => {
    const now = new Date('2026-07-20T08:00:00.000Z');
    mocks.prisma.userDevice.findMany.mockResolvedValue([
      {
        deviceId: 'device-current',
        platform: 'UNKNOWN',
        createdAt: now,
        lastSeenAt: now,
        revokedAt: null,
      },
      {
        deviceId: 'device-phone',
        platform: 'ANDROID',
        createdAt: now,
        lastSeenAt: now,
        revokedAt: null,
      },
    ]);
    app = await createApp();

    const response = await app.inject({ method: 'GET', url: '/v1/auth/devices' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({ deviceId: 'device-current', isCurrent: true }),
      expect.objectContaining({ deviceId: 'device-phone', isCurrent: false }),
    ]);
  });

  it('revokes only a device belonging to the authenticated account', async () => {
    app = await createApp();

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/auth/devices/device-phone',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.prisma.userDevice.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-a', deviceId: 'device-phone' },
      data: {
        revokedAt: expect.any(Date),
        refreshTokenHash: null,
        refreshTokenJti: null,
        pushToken: null,
        pushBindingId: null,
        pushTokenUpdatedAt: null,
      },
    });
    expect(mocks.disconnectDevice).toHaveBeenCalledWith('user-a', 'device-phone');
  });

  it('binds an FCM registration only to the authenticated device session', async () => {
    const token = 'fcm-registration-token-current-device';
    const bindingId = '06927bcd-9b16-4480-a031-33fbb4a84732';
    mocks.transaction.userDevice.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/push-registration',
      payload: { provider: 'FCM', registrationId: token, bindingId },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        registered: true,
        deliveryEnabled: config.PUSH_PROVIDER === 'fcm',
      },
    });
    expect(mocks.transaction.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.userDevice.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: { not: 'device-row-current' },
        OR: [
          { pushToken: token },
          { pushBindingId: bindingId },
        ],
      },
      data: {
        pushToken: null,
        pushBindingId: null,
        pushTokenUpdatedAt: null,
      },
    });
    expect(mocks.transaction.userDevice.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'device-row-current',
        sessionId: 'session-current',
        revokedAt: null,
      },
      data: {
        platform: 'ANDROID',
        pushToken: token,
        pushBindingId: bindingId,
        pushTokenUpdatedAt: expect.any(Date),
        lastSeenAt: expect.any(Date),
      },
    });
  });

  it('compare-and-clears only the previous FCM registration', async () => {
    const token = 'fcm-registration-token-to-remove';
    const bindingId = '06927bcd-9b16-4480-a031-33fbb4a84732';
    app = await createApp();

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/auth/push-registration',
      payload: { provider: 'FCM', registrationId: token, bindingId },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.prisma.userDevice.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        deviceId: 'device-current',
        sessionId: 'session-current',
        revokedAt: null,
        pushToken: token,
        pushBindingId: bindingId,
      },
      data: {
        pushToken: null,
        pushBindingId: null,
        pushTokenUpdatedAt: null,
      },
    });
    expect(response.json().data).toEqual({
      registered: false,
      deliveryEnabled: config.PUSH_PROVIDER === 'fcm',
    });
  });

  it('rejects a delayed registration when a newer owner already has the token', async () => {
    const token = 'fcm-registration-token-current-device';
    const bindingId = '06927bcd-9b16-4480-a031-33fbb4a84732';
    mocks.transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'device-row-current',
          userId: 'user-a',
          deviceId: 'device-current',
          sessionId: 'session-current',
          authenticatedAt: new Date('2026-07-22T10:00:00.000Z'),
          revokedAt: null,
          pushToken: null,
          pushBindingId: null,
        },
        {
          id: 'device-row-newer',
          userId: 'user-b',
          deviceId: 'other-device-id',
          sessionId: 'session-newer',
          authenticatedAt: new Date('2026-07-22T10:00:01.000Z'),
          revokedAt: null,
          pushToken: token,
          pushBindingId: '3b9dd571-6d6a-493f-8988-0ac4caf75b82',
        },
      ]);
    app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/push-registration',
      payload: { provider: 'FCM', registrationId: token, bindingId },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('PUSH_SESSION_STALE');
    expect(mocks.transaction.userDevice.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous registration when another owner authenticated in the same millisecond', async () => {
    const token = 'fcm-registration-token-current-device';
    const bindingId = '06927bcd-9b16-4480-a031-33fbb4a84732';
    const authenticatedAt = new Date('2026-07-22T10:00:00.000Z');
    mocks.transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'device-row-current',
          userId: 'user-a',
          deviceId: 'device-current',
          sessionId: 'session-current',
          authenticatedAt,
          revokedAt: null,
          pushToken: null,
          pushBindingId: null,
        },
        {
          id: 'device-row-other',
          userId: 'user-b',
          deviceId: 'other-device-id',
          sessionId: 'session-other',
          authenticatedAt,
          revokedAt: null,
          pushToken: token,
          pushBindingId: '3b9dd571-6d6a-493f-8988-0ac4caf75b82',
        },
      ]);
    app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/push-registration',
      payload: { provider: 'FCM', registrationId: token, bindingId },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('PUSH_SESSION_STALE');
    expect(mocks.transaction.userDevice.updateMany).not.toHaveBeenCalled();
  });
});
