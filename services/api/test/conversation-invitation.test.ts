import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    conversation: { update: vi.fn() },
    participant: { findFirst: vi.fn(), update: vi.fn() },
    guestIdentity: { updateMany: vi.fn() },
    meetingInvitation: { updateMany: vi.fn() },
    translationMessage: { updateMany: vi.fn() },
  };
  return {
    transaction,
    getConversationForAuth: vi.fn(),
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)),
    },
  };
});

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));
vi.mock('../src/auth.js', () => ({
  authenticate: vi.fn(),
  requireRole: () => async (request: { auth?: unknown }) => {
    request.auth = {
      subjectId: 'host-a',
      role: 'USER',
      deviceId: 'host-device-a',
      sessionId: 'host-session-a',
    };
  },
}));
vi.mock('../src/services/conversations.js', () => ({
  conversationInclude: {},
  conversationDto: vi.fn(),
  findInvitation: vi.fn(),
  getConversationForAuth: mocks.getConversationForAuth,
  messageDto: vi.fn(),
}));
vi.mock('../src/services/audio-deletion-outbox.js', () => ({
  enqueueAudioDeletionJobs: vi.fn(),
  wakeAudioDeletionWorker: vi.fn(),
}));
vi.mock('../src/services/message-processing.js', () => ({
  recoverStaleProcessingMessages: vi.fn(),
}));
vi.mock('../src/realtime-hub.js', () => ({
  realtimeHub: () => ({
    emitToConversation: vi.fn(),
    emitToSubject: vi.fn(),
    disconnectParticipant: vi.fn(),
  }),
}));

import { registerConversationRoutes } from '../src/routes/conversations.js';
import { AppError } from '../src/errors.js';
import { stableHash } from '../src/lib/crypto.js';

let app: FastifyInstance | undefined;

const expiresAt = new Date(Date.now() + 60_000);
const current = {
  id: 'conversation-a',
  ownerId: 'host-a',
  status: 'WAITING',
  expiresAt,
  roomTokenHash: 'old-token-hash',
  roomCodeHash: 'old-code-hash',
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getConversationForAuth.mockResolvedValue(current);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.transaction) => unknown) => callback(mocks.transaction),
  );
  mocks.transaction.$queryRaw.mockResolvedValue([current]);
  mocks.transaction.participant.findFirst.mockResolvedValue({
    id: 'participant-a',
    conversationId: 'conversation-a',
    role: 'GUEST',
    guestIdentityId: 'guest-a',
    userId: null,
  });
  mocks.transaction.participant.update.mockResolvedValue({
    id: 'participant-a',
    conversationId: 'conversation-a',
    role: 'GUEST',
    guestIdentityId: 'guest-a',
    userId: null,
  });
  app = Fastify({ logger: false });
  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof AppError) {
      await reply.code(error.statusCode).send({ ok: false, code: error.code });
      return;
    }
    throw error;
  });
  await registerConversationRoutes(app);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('Host invitation rotation', () => {
  it('replaces both credential hashes under a row lock and returns secrets once', async () => {
    const response = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/invitation/rotate',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const data = response.json().data as {
      conversationId: string;
      roomToken: string;
      roomCode: string;
      inviteUrl: string;
      expiresAt: string;
    };
    expect(data.conversationId).toBe('conversation-a');
    expect(data.roomToken.length).toBeGreaterThanOrEqual(32);
    expect(data.roomCode).toMatch(/^\d{8}$/);
    expect(data.inviteUrl).toContain(`/join/${data.roomToken}`);
    expect(new Date(data.expiresAt)).toEqual(expiresAt);
    expect(mocks.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.transaction.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-a' },
      data: {
        roomTokenHash: stableHash(data.roomToken),
        roomCodeHash: stableHash(data.roomCode),
      },
    });
  });

  it('rejects a concurrent rotation that changed either stored hash', async () => {
    mocks.transaction.$queryRaw.mockResolvedValue([
      { ...current, roomTokenHash: 'already-rotated' },
    ]);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/invitation/rotate',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVITATION_ROTATE_CONFLICT');
    expect(mocks.transaction.conversation.update).not.toHaveBeenCalled();
  });

  it.each([
    ['ENDED', 409, 'ROOM_ENDED'],
    ['EXPIRED', 403, 'ROOM_EXPIRED'],
  ])('rejects the %s state', async (status, expectedStatus, expectedCode) => {
    mocks.getConversationForAuth.mockResolvedValue({ ...current, status });

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/invitation/rotate',
    });

    expect(response.statusCode).toBe(expectedStatus);
    expect(response.json().code).toBe(expectedCode);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('participant removal isolation', () => {
  it('removes the selected Guest and invalidates the shared invitation credentials', async () => {
    mocks.getConversationForAuth.mockResolvedValue({ ...current, status: 'ACTIVE' });
    mocks.transaction.$queryRaw.mockResolvedValue([{ ...current, status: 'ACTIVE' }]);

    const response = await app!.inject({
      method: 'DELETE',
      url: '/v1/conversations/conversation-a/participants/participant-a',
    });

    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data as {
      conversationId: string;
      participantId: string;
      invitationRotated: boolean;
    };
    expect(data.conversationId).toBe('conversation-a');
    expect(data.participantId).toBe('participant-a');
    expect(data.invitationRotated).toBe(true);
    expect(mocks.transaction.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-a' },
      data: {
        roomTokenHash: expect.any(String),
        roomCodeHash: expect.any(String),
      },
    });
    expect(mocks.transaction.participant.update).toHaveBeenCalledWith({
      where: { id: 'participant-a' },
      data: {
        removedAt: expect.any(Date),
        leftAt: expect.any(Date),
        lastSeenAt: expect.any(Date),
        presence: 'REMOVED',
      },
    });
  });
});
