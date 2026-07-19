import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { getConversationForAuthInTransaction } from '../src/services/conversations.js';

const baseConversation = {
  id: 'conversation-a',
  ownerId: 'host-a',
  contactId: 'contact-a',
  title: 'Meeting',
  hostLanguage: 'zh',
  guestLanguage: 'ru',
  status: 'ENDED',
  roomTokenHash: 'room-token-hash',
  roomCodeHash: 'room-code-hash',
  guestHistoryPolicy: 'PERMANENT',
  guestAccessExpiresAt: null,
  expiresAt: new Date('2999-01-01T00:00:00.000Z'),
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  endedAt: new Date('2026-01-01T01:00:00.000Z'),
  maxSequence: 2,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T01:00:00.000Z'),
  contact: { id: 'contact-a', displayName: 'Customer', company: null },
  participants: [],
  _count: { messages: 2, participants: 2 },
} as const;

function registeredTransaction(options: {
  participant?: { id: string } | null;
  revokedAt?: Date | null;
} = {}) {
  const queryRaw = vi.fn()
    .mockResolvedValueOnce([{
      id: baseConversation.id,
      status: baseConversation.status,
      expiresAt: baseConversation.expiresAt,
    }])
    .mockResolvedValueOnce([{ id: 'customer-a', status: 'ACTIVE' }])
    .mockResolvedValueOnce([{
      sessionId: 'session-a',
      revokedAt: options.revokedAt ?? null,
    }]);
  const findParticipant = vi.fn().mockResolvedValue(
    options.participant === undefined ? { id: 'participant-a' } : options.participant,
  );
  const tx = {
    $queryRaw: queryRaw,
    conversation: {
      findUnique: vi.fn().mockResolvedValue(baseConversation),
      update: vi.fn(),
    },
    translationMessage: { updateMany: vi.fn() },
    participant: { findFirst: findParticipant },
  } as unknown as Prisma.TransactionClient;
  return { tx, queryRaw, findParticipant };
}

describe('transactional conversation read authorization', () => {
  it('locks the account generation before checking the server membership', async () => {
    const { tx, queryRaw, findParticipant } = registeredTransaction();

    await expect(getConversationForAuthInTransaction(
      tx,
      {
        subjectId: 'customer-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
      { history: true },
    )).resolves.toMatchObject({ id: 'conversation-a' });

    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      findParticipant.mock.invocationCallOrder[0]!,
    );
    expect(findParticipant).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation-a',
        userId: 'customer-a',
        removedAt: null,
      },
      select: { id: true },
    });
  });

  it('does not continue to the membership or protected read after device revocation', async () => {
    const { tx, findParticipant } = registeredTransaction({
      revokedAt: new Date('2026-01-01T00:30:00.000Z'),
    });

    await expect(getConversationForAuthInTransaction(
      tx,
      {
        subjectId: 'customer-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
      { history: true },
    )).rejects.toMatchObject({ code: 'DEVICE_REVOKED', statusCode: 401 });
    expect(findParticipant).not.toHaveBeenCalled();
  });

  it('hides the conversation after a committed participant removal', async () => {
    const { tx } = registeredTransaction({ participant: null });

    await expect(getConversationForAuthInTransaction(
      tx,
      {
        subjectId: 'customer-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
      { history: true },
    )).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND', statusCode: 404 });
  });
});
