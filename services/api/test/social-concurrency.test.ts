import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    conversation: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
    participant: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    friendRequest: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    friendship: { findUnique: vi.fn(), upsert: vi.fn() },
    meetingInvitation: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn(),
    },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)),
      friendRequest: { findFirst: vi.fn() },
      friendship: { findUnique: vi.fn() },
      meetingInvitation: { findFirst: vi.fn() },
    },
  };
});

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));
vi.mock('../src/auth.js', () => ({
  authenticate: async (request: {
    auth?: unknown;
    headers: Record<string, string | string[] | undefined>;
  }) => {
    request.auth = {
      subjectId: String(request.headers['x-test-subject'] ?? 'invitee-a'),
      role: 'USER',
      deviceId: 'device-a',
    };
  },
}));
vi.mock('../src/realtime-hub.js', () => ({
  realtimeHub: () => ({
    emitToSubject: vi.fn(),
    isSubjectOnline: vi.fn().mockResolvedValue(false),
  }),
}));
vi.mock('../src/services/conversations.js', () => ({
  conversationInclude: {},
  conversationDto: (value: unknown) => value,
  participantDto: (value: unknown) => value,
}));

import { AppError } from '../src/errors.js';
import { registerSocialRoutes } from '../src/routes/social.js';

let app: FastifyInstance | undefined;
const now = new Date();
const user = (id: string) => ({
  id,
  displayName: id,
  email: `${id}@example.test`,
  company: 'Company',
  preferredLanguage: 'ru',
});
const invitation = {
  id: 'invitation-a',
  conversationId: 'conversation-a',
  inviterId: 'host-a',
  inviteeId: 'invitee-a',
  status: 'PENDING',
  createdAt: now,
  updatedAt: now,
  respondedAt: null,
  inviter: user('host-a'),
  invitee: user('invitee-a'),
  conversation: {
    id: 'conversation-a',
    title: 'Meeting',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60_000),
    contact: { displayName: 'Contact', company: 'Company' },
  },
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.transaction) => unknown) => callback(mocks.transaction),
  );
  app = Fastify({ logger: false });
  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof AppError) {
      await reply.code(error.statusCode).send({ ok: false, code: error.code });
      return;
    }
    throw error;
  });
  await registerSocialRoutes(app);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('social response compare-and-swap', () => {
  it('does not create a friendship when another response already claimed the request', async () => {
    mocks.prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'request-a',
      senderId: 'sender-a',
      receiverId: 'invitee-a',
      status: 'PENDING',
    });
    mocks.transaction.$queryRaw.mockResolvedValue([
      { id: 'invitee-a', status: 'ACTIVE' },
      { id: 'sender-a', status: 'ACTIVE' },
    ]);
    mocks.transaction.friendRequest.updateMany.mockResolvedValue({ count: 0 });

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/friend-requests/request-a/respond',
      payload: { action: 'ACCEPT' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('FRIEND_REQUEST_ALREADY_RESPONDED');
    expect(mocks.transaction.friendship.upsert).not.toHaveBeenCalled();
  });

  it('does not recreate social rows after either account has been deleted', async () => {
    mocks.prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'request-a',
      senderId: 'sender-a',
      receiverId: 'invitee-a',
      status: 'PENDING',
    });
    mocks.transaction.$queryRaw.mockResolvedValue([
      { id: 'invitee-a', status: 'ACTIVE' },
      { id: 'sender-a', status: 'DELETED' },
    ]);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/friend-requests/request-a/respond',
      payload: { action: 'ACCEPT' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('USER_NOT_FOUND');
    expect(mocks.transaction.friendRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.friendship.upsert).not.toHaveBeenCalled();
  });

  it('does not accept an invitation after Host end wins the Conversation lock', async () => {
    mocks.prisma.meetingInvitation.findFirst.mockResolvedValue(invitation);
    mocks.transaction.$queryRaw.mockResolvedValue([{
      id: 'conversation-a',
      ownerId: 'host-a',
      status: 'ENDED',
      expiresAt: invitation.conversation.expiresAt,
      startedAt: now,
    }]);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/meeting-invitations/invitation-a/respond',
      payload: {
        action: 'ACCEPT',
        displayName: 'Ivan',
        company: 'RU Trade',
        preferredLanguage: 'ru',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('ROOM_EXPIRED');
    expect(mocks.transaction.meetingInvitation.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.conversation.update).not.toHaveBeenCalled();
  });

  it('does not create a new invitation after Host end wins the Conversation lock', async () => {
    mocks.transaction.$queryRaw.mockResolvedValue([{
      id: 'conversation-a',
      ownerId: 'host-a',
      status: 'ENDED',
      expiresAt: invitation.conversation.expiresAt,
      startedAt: now,
    }]);

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/invitations',
      headers: { 'x-test-subject': 'host-a' },
      payload: { inviteeId: 'invitee-a' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('ROOM_NOT_ACTIVE');
    expect(mocks.transaction.meetingInvitation.upsert).not.toHaveBeenCalled();
  });

  it('does not create a participant when another invitation response wins the CAS', async () => {
    mocks.prisma.meetingInvitation.findFirst.mockResolvedValue(invitation);
    mocks.transaction.$queryRaw
      .mockResolvedValueOnce([{
        id: 'conversation-a',
        ownerId: 'host-a',
        status: 'ACTIVE',
        expiresAt: invitation.conversation.expiresAt,
        startedAt: now,
      }])
      .mockResolvedValueOnce([
        { id: 'host-a', status: 'ACTIVE' },
        { id: 'invitee-a', status: 'ACTIVE' },
      ]);
    mocks.transaction.meetingInvitation.updateMany.mockResolvedValue({ count: 0 });

    const response = await app!.inject({
      method: 'POST',
      url: '/v1/meeting-invitations/invitation-a/respond',
      payload: {
        action: 'ACCEPT',
        displayName: 'Ivan',
        company: 'RU Trade',
        preferredLanguage: 'ru',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('MEETING_INVITATION_ALREADY_RESPONDED');
    expect(mocks.transaction.participant.create).not.toHaveBeenCalled();
    expect(mocks.transaction.conversation.update).not.toHaveBeenCalled();
  });
});
