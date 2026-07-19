import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    conversation: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    translationMessage: { create: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      translationMessage: { findUnique: vi.fn() },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)),
    },
  };
});

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));

import { acquireProcessingAttempt } from '../src/routes/messages.js';

const guestAuth = {
  subjectId: 'guest-a',
  guestIdentityId: 'guest-a',
  conversationId: 'conversation-a',
  role: 'GUEST' as const,
  deviceId: 'device-a',
  sessionId: 'session-a',
};

function activeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    removedAt: null,
    leftAt: null,
    presence: 'OFFLINE',
    role: 'GUEST',
    displayName: 'Ivan locked',
    company: 'Locked Company',
    preferredLanguage: 'zh',
    userId: null,
    guestIdentityId: 'guest-a',
    ...overrides,
  };
}

function configureAuthorizationRows(
  participant = activeParticipant(),
  guestOverrides: Record<string, unknown> = {},
) {
  mocks.transaction.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = Array.from(strings).join('?');
    if (sql.includes('FROM "Conversation"')) {
      return [{ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }];
    }
    if (sql.includes('FROM "GuestIdentity"')) {
      return [{
        id: 'guest-a',
        sessionId: 'session-a',
        deviceId: 'device-a',
        conversationId: 'conversation-a',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        ...guestOverrides,
      }];
    }
    if (sql.includes('FROM "Participant"')) return [participant];
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.translationMessage.findUnique.mockResolvedValue(null);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.transaction) => unknown) => callback(mocks.transaction),
  );
  mocks.transaction.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.conversation.findUniqueOrThrow.mockResolvedValue({ maxSequence: 1 });
  mocks.transaction.translationMessage.create.mockImplementation(async ({ data }) => ({
    id: 'message-a',
    status: 'PROCESSING',
    updatedAt: new Date(),
    ...data,
  }));
  configureAuthorizationRows();
});

describe('new message acquisition', () => {
  it('checks identity and participant under the Conversation lock before creating PROCESSING', async () => {
    configureAuthorizationRows(activeParticipant({ removedAt: new Date(), presence: 'REMOVED' }));

    await expect(acquireProcessingAttempt({
      request: { auth: guestAuth } as never,
      conversationId: 'conversation-a',
      idempotencyKey: 'message-key-0001',
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      sourceText: '这个请求不应触发供应商调用',
    }, {
      id: 'removed-participant',
      role: 'GUEST',
    })).rejects.toMatchObject({ code: 'PARTICIPANT_REMOVED', statusCode: 403 });

    expect(mocks.transaction.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.$queryRaw).toHaveBeenCalledTimes(3);
    expect(mocks.transaction.translationMessage.create).not.toHaveBeenCalled();
  });

  it('persists typed source text on the initial PROCESSING row', async () => {
    await acquireProcessingAttempt({
      request: { auth: guestAuth } as never,
      conversationId: 'conversation-a',
      idempotencyKey: 'message-key-0002',
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      sourceText: '已知原文',
    }, {
      id: 'participant-a',
      role: 'GUEST',
      displayName: 'Ivan',
      company: 'RU Trade',
      preferredLanguage: 'zh',
    });

    expect(mocks.transaction.translationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceText: '已知原文',
        speakerDisplayName: 'Ivan locked',
        speakerCompany: 'Locked Company',
      }),
    });
  });

  it('does not allocate a sequence after the guest session was revoked', async () => {
    configureAuthorizationRows(activeParticipant(), { revokedAt: new Date() });

    await expect(acquireProcessingAttempt({
      request: { auth: guestAuth } as never,
      conversationId: 'conversation-a',
      idempotencyKey: 'message-key-0003',
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      sourceText: '不应发送给供应商',
    }, {
      id: 'participant-a',
      role: 'GUEST',
      displayName: 'Ivan',
      company: 'RU Trade',
      preferredLanguage: 'zh',
    })).rejects.toMatchObject({ code: 'GUEST_TOKEN_REVOKED', statusCode: 401 });

    expect(mocks.transaction.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.translationMessage.create).not.toHaveBeenCalled();
  });
});
