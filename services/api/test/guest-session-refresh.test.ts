import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    guestPrincipal: { updateMany: vi.fn() },
    guestIdentity: { updateMany: vi.fn() },
    participant: { updateMany: vi.fn() },
  };
  return {
    transaction,
    disconnectSubject: vi.fn(),
    prisma: {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
      ),
      userDevice: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
      user: { findUnique: vi.fn(), create: vi.fn() },
      glossaryTerm: { createMany: vi.fn() },
    },
  };
});

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));
vi.mock('../src/realtime-hub.js', () => ({
  realtimeHub: () => ({
    disconnectSubject: mocks.disconnectSubject,
    disconnectDevice: vi.fn(),
  }),
}));

import { registerAuthRoutes } from '../src/routes/auth.js';
import { AppError } from '../src/errors.js';
import { verifyAccessToken } from '../src/lib/tokens.js';
import {
  logoutGuestSession,
  refreshGuestSession,
} from '../src/services/guest-session.js';

let app: FastifyInstance | undefined;

const conversation = {
  id: 'conversation-a',
  status: 'ACTIVE',
  guestHistoryPolicy: 'ACCESS_FOR_24_HOURS',
  guestAccessExpiresAt: null,
  expiresAt: new Date(Date.now() + 60 * 60_000),
};
const principal = {
  id: 'principal-a',
  revokedAt: null,
  lastSeenAt: new Date(Date.now() - 15 * 60_000),
};
const identity = {
  id: 'guest-a',
  sessionId: 'guest-session-old',
  displayName: 'Ivan',
  company: 'Example LLC',
  preferredLanguage: 'ru',
  deviceId: 'guest-device-a',
  conversationId: 'conversation-a',
  guestPrincipalId: 'principal-a',
  expiresAt: conversation.expiresAt,
  revokedAt: null,
};
const participant = {
  id: 'participant-a',
  conversationId: 'conversation-a',
  guestIdentityId: 'guest-a',
  presence: 'ONLINE',
  leftAt: null,
  removedAt: null,
};
const payload = {
  guestPrincipalToken: 'guest-principal-token-1234567890123456',
  conversationId: 'conversation-a',
  deviceId: 'guest-device-a',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.transaction) => unknown) =>
      callback(mocks.transaction),
  );
  mocks.transaction.$queryRaw
    .mockResolvedValueOnce([conversation])
    .mockResolvedValueOnce([principal])
    .mockResolvedValueOnce([identity])
    .mockResolvedValueOnce([participant]);
  mocks.transaction.guestPrincipal.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.guestIdentity.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.participant.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function errorEnvelope(instance: FastifyInstance): void {
  instance.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof AppError) {
      await reply.code(error.statusCode).send({ ok: false, code: error.code });
      return;
    }
    throw error;
  });
}

async function createApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  errorEnvelope(instance);
  await registerAuthRoutes(instance);
  return instance;
}

describe('guest principal session renewal', () => {
  it('rotates a scoped session without requiring a bearer token or invitation', async () => {
    app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest/refresh',
      payload,
    });

    expect(response.statusCode, response.body).toBe(200);
    const claims = await verifyAccessToken(response.json().data.accessToken);
    expect(claims).toMatchObject({
      subjectId: 'guest-a',
      guestIdentityId: 'guest-a',
      conversationId: 'conversation-a',
      deviceId: 'guest-device-a',
      role: 'GUEST',
    });
    expect(claims.sessionId).not.toBe(identity.sessionId);
    expect(mocks.transaction.guestIdentity.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'guest-a',
        conversationId: 'conversation-a',
        guestPrincipalId: 'principal-a',
        deviceId: 'guest-device-a',
        sessionId: 'guest-session-old',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { sessionId: claims.sessionId },
    });
    expect(mocks.disconnectSubject).toHaveBeenCalledWith('guest-a');
  });

  it('coalesces concurrent recovery onto one CAS-protected session generation', async () => {
    let transactionTail = Promise.resolve<unknown>(undefined);
    let queryStep = 0;
    let currentSessionId = identity.sessionId;
    let currentLastSeenAt = principal.lastSeenAt;

    mocks.transaction.$queryRaw.mockReset().mockImplementation(async () => {
      const step = queryStep++;
      if (step === 0) return [conversation];
      if (step === 1) return [{ ...principal, lastSeenAt: currentLastSeenAt }];
      if (step === 2) return [{ ...identity, sessionId: currentSessionId }];
      if (step === 3) return [participant];
      throw new Error(`unexpected query step ${step}`);
    });
    mocks.transaction.guestPrincipal.updateMany.mockImplementation(async ({ data }) => {
      currentLastSeenAt = data.lastSeenAt;
      return { count: 1 };
    });
    mocks.transaction.guestIdentity.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.sessionId !== currentSessionId) return { count: 0 };
      currentSessionId = data.sessionId;
      return { count: 1 };
    });
    mocks.prisma.$transaction.mockImplementation((callback) => {
      const run = transactionTail.then(async () => {
        queryStep = 0;
        return callback(mocks.transaction);
      });
      transactionTail = run.catch(() => undefined);
      return run;
    });

    app = await createApp();
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/auth/guest/refresh', payload }),
      app.inject({ method: 'POST', url: '/v1/auth/guest/refresh', payload }),
    ]);

    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    const firstClaims = await verifyAccessToken(first.json().data.accessToken);
    const secondClaims = await verifyAccessToken(second.json().data.accessToken);
    expect(firstClaims.sessionId).toBe(secondClaims.sessionId);
    expect(firstClaims.sessionId).not.toBe(identity.sessionId);
    expect(mocks.transaction.guestPrincipal.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.guestIdentity.updateMany).toHaveBeenCalledTimes(2);
  });

  it('serializes refresh and explicit logout so renewal cannot escape logout', async () => {
    let transactionTail = Promise.resolve<unknown>(undefined);
    let currentSessionId = identity.sessionId;
    let currentExpiresAt = identity.expiresAt;
    let currentLastSeenAt = principal.lastSeenAt;
    const firstQueries: string[] = [];
    let firstQueryInTransaction = false;

    mocks.prisma.$transaction.mockImplementation((callback) => {
      const run = transactionTail.then(async () => {
        firstQueryInTransaction = true;
        return callback(mocks.transaction);
      });
      transactionTail = run.catch(() => undefined);
      return run;
    });
    mocks.transaction.$queryRaw.mockReset().mockImplementation(async (strings) => {
      const sql = Array.from(strings as TemplateStringsArray).join(' ');
      if (firstQueryInTransaction) {
        firstQueries.push(sql);
        firstQueryInTransaction = false;
      }
      if (sql.includes('FROM "Conversation"')) return [conversation];
      if (sql.includes('FROM "GuestPrincipal"')) {
        return [{ ...principal, lastSeenAt: currentLastSeenAt }];
      }
      if (sql.includes('FROM "GuestIdentity"')) {
        return [{
          ...identity,
          sessionId: currentSessionId,
          expiresAt: currentExpiresAt,
        }];
      }
      if (sql.includes('FROM "Participant"')) return [participant];
      throw new Error(`unexpected query: ${sql}`);
    });
    mocks.transaction.guestPrincipal.updateMany.mockImplementation(async ({ data }) => {
      currentLastSeenAt = data.lastSeenAt;
      return { count: 1 };
    });
    mocks.transaction.guestIdentity.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.sessionId != null && where.sessionId !== currentSessionId) {
        return { count: 0 };
      }
      currentSessionId = data.sessionId;
      if (data.expiresAt != null) currentExpiresAt = data.expiresAt;
      return { count: 1 };
    });

    const refreshAt = new Date();
    const logoutAt = new Date(refreshAt.getTime() + 1);
    const [refreshed, loggedOut] = await Promise.all([
      refreshGuestSession({ ...payload, now: refreshAt }),
      logoutGuestSession({
        guestIdentityId: identity.id,
        conversationId: identity.conversationId,
        deviceId: identity.deviceId,
        now: logoutAt,
      }),
    ]);

    expect(loggedOut).toBe(true);
    expect(refreshed.sessionId).not.toBe(identity.sessionId);
    expect(currentSessionId).not.toBe(refreshed.sessionId);
    expect(currentExpiresAt).toEqual(logoutAt);
    expect(firstQueries).toHaveLength(2);
    expect(firstQueries.every((sql) => sql.includes('FROM "Conversation"'))).toBe(true);
  });

  it('fails closed when the final identity CAS loses a lifecycle race', async () => {
    mocks.transaction.guestIdentity.updateMany.mockResolvedValue({ count: 0 });
    app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest/refresh',
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, code: 'GUEST_REFRESH_INVALID' });
    expect(mocks.disconnectSubject).not.toHaveBeenCalled();
  });

  it('renews read-only access after end only while the guest history policy allows it', async () => {
    const historyExpiry = new Date(Date.now() + 24 * 60 * 60_000);
    const endedConversation = {
      ...conversation,
      status: 'ENDED',
      guestAccessExpiresAt: historyExpiry,
      expiresAt: new Date(Date.now() - 60_000),
    };
    mocks.transaction.$queryRaw.mockReset()
      .mockResolvedValueOnce([endedConversation])
      .mockResolvedValueOnce([principal])
      .mockResolvedValueOnce([{ ...identity, expiresAt: historyExpiry }])
      .mockResolvedValueOnce([{
        ...participant,
        presence: 'LEFT',
        leftAt: new Date(),
      }]);
    app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest/refresh',
      payload,
    });

    expect(response.statusCode, response.body).toBe(200);
    await expect(verifyAccessToken(response.json().data.accessToken)).resolves.toMatchObject({
      conversationId: 'conversation-a',
      role: 'GUEST',
    });
  });

  it.each([
    ['unknown principal', [conversation], [null], null, null],
    ['wrong device', [conversation], [principal], [identity], [participant]],
    [
      'removed participant',
      [conversation],
      [principal],
      [identity],
      [{ ...participant, presence: 'REMOVED', removedAt: new Date() }],
    ],
  ])('does not reveal whether %s exists or is revoked', async (name, c, p, i, member) => {
    void name;
    mocks.transaction.$queryRaw.mockReset();
    mocks.transaction.$queryRaw.mockResolvedValueOnce(c).mockResolvedValueOnce(p);
    if (i) mocks.transaction.$queryRaw.mockResolvedValueOnce(i);
    if (member) mocks.transaction.$queryRaw.mockResolvedValueOnce(member);
    app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/guest/refresh',
      payload: name === 'wrong device' ? { ...payload, deviceId: 'different-device' } : payload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, code: 'GUEST_REFRESH_INVALID' });
  });
});
