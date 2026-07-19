import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  advanceMessageReviewProposal,
  assertMessageReviewActor,
  correctionRequestHash,
  lockAndAssertReviewActor,
  upsertConfirmedGlossaryTerm,
  type ReviewContext,
} from '../src/routes/message-reviews.js';

describe('message review authorization', () => {
  it('allows only the conversation owner or the actual speaker', () => {
    expect(() => assertMessageReviewActor({
      conversationOwnerId: 'host-1',
      actorSubjectId: 'host-1',
      actorParticipantId: 'host-participant',
      messageParticipantId: 'speaker-participant',
    })).not.toThrow();

    expect(() => assertMessageReviewActor({
      conversationOwnerId: 'host-1',
      actorSubjectId: 'customer-1',
      actorParticipantId: 'speaker-participant',
      messageParticipantId: 'speaker-participant',
    })).not.toThrow();

    expect(() => assertMessageReviewActor({
      conversationOwnerId: 'host-1',
      actorSubjectId: 'customer-2',
      actorParticipantId: 'other-participant',
      messageParticipantId: 'speaker-participant',
    })).toThrowError(expect.objectContaining({
      code: 'MESSAGE_REVIEW_FORBIDDEN',
      statusCode: 403,
    }));
  });

  it('binds an idempotency key to the exact request body', () => {
    const input = {
      kind: 'MANUAL',
      sourceText: '修正原文',
      translatedText: 'Исправленный перевод',
      expectedRevision: 2,
    };
    expect(correctionRequestHash(input)).toBe(correctionRequestHash(input));
    expect(correctionRequestHash(input)).not.toBe(correctionRequestHash({
      ...input,
      translatedText: 'Другой перевод',
    }));
  });
});

describe('message review compare-and-swap', () => {
  it('advances only the caller expected revision', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await advanceMessageReviewProposal(
      { translationMessage: { updateMany } } as unknown as Pick<
        Prisma.TransactionClient,
        'translationMessage'
      >,
      {
        messageId: 'message-1',
        conversationId: 'conversation-1',
        expectedRevision: 4,
        proposedSourceText: '新原文',
        proposedTranslatedText: 'Новый перевод',
      },
    );

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'message-1',
        conversationId: 'conversation-1',
        status: 'FINAL',
        reviewRevision: 4,
      }),
      data: expect.objectContaining({
        reviewRevision: { increment: 1 },
        reviewStatus: 'PENDING',
      }),
    }));
  });

  it('rejects a stale revision instead of overwriting a newer review', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(advanceMessageReviewProposal(
      { translationMessage: { updateMany } } as unknown as Pick<
        Prisma.TransactionClient,
        'translationMessage'
      >,
      {
        messageId: 'message-1',
        conversationId: 'conversation-1',
        expectedRevision: 3,
        proposedSourceText: '过期原文',
        proposedTranslatedText: 'Устаревший перевод',
      },
    )).rejects.toMatchObject({
      code: 'MESSAGE_REVIEW_CONFLICT',
      statusCode: 409,
    });
  });
});

describe('message review removal race', () => {
  it('revalidates a registered participant and device under row locks', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        id: 'conversation-1', ownerId: 'host-1', status: 'ACTIVE',
        expiresAt: new Date('2999-07-20T10:00:00Z'),
      }])
      .mockResolvedValueOnce([{
        id: 'user-1', status: 'ACTIVE',
      }])
      .mockResolvedValueOnce([{ sessionId: 'session-1', revokedAt: null }])
      .mockResolvedValueOnce([{
        id: 'participant-1', userId: 'user-1', guestIdentityId: null,
        removedAt: null, leftAt: null, presence: 'ONLINE',
      }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(lockAndAssertReviewActor(
      tx,
      registeredContext(),
    )).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('denies a write when Host removal committed during provider latency', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        id: 'conversation-1', ownerId: 'host-1', status: 'ACTIVE',
        expiresAt: new Date('2999-07-20T10:00:00Z'),
      }])
      .mockResolvedValueOnce([{
        id: 'user-1', status: 'ACTIVE',
      }])
      .mockResolvedValueOnce([{ sessionId: 'session-1', revokedAt: null }])
      .mockResolvedValueOnce([{
        id: 'participant-1',
        userId: 'user-1',
        guestIdentityId: null,
        removedAt: new Date('2026-07-19T10:00:00Z'),
        leftAt: new Date('2026-07-19T10:00:00Z'),
        presence: 'REMOVED',
      }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(lockAndAssertReviewActor(
      tx,
      registeredContext(),
    )).rejects.toMatchObject({
      code: 'PARTICIPANT_REMOVED',
      statusCode: 403,
    });
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('keeps history readable but denies review writes after the participant leaves', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        id: 'conversation-1', ownerId: 'host-1', status: 'ACTIVE',
        expiresAt: new Date('2999-07-20T10:00:00Z'),
      }])
      .mockResolvedValueOnce([{
        id: 'user-1', status: 'ACTIVE',
      }])
      .mockResolvedValueOnce([{ sessionId: 'session-1', revokedAt: null }])
      .mockResolvedValueOnce([{
        id: 'participant-1',
        userId: 'user-1',
        guestIdentityId: null,
        removedAt: null,
        leftAt: new Date('2026-07-19T10:00:00Z'),
        presence: 'LEFT',
      }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(lockAndAssertReviewActor(
      tx,
      registeredContext(),
    )).rejects.toMatchObject({
      code: 'PARTICIPANT_LEFT',
      statusCode: 403,
    });
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('denies a guest whose scoped server identity was revoked', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        id: 'conversation-1', ownerId: 'host-1', status: 'ACTIVE',
        expiresAt: new Date('2999-07-20T10:00:00Z'),
      }])
      .mockResolvedValueOnce([{
        id: 'guest-1',
        conversationId: 'conversation-1',
        sessionId: 'guest-session',
        revokedAt: new Date('2026-07-19T10:00:00Z'),
        expiresAt: new Date('2026-07-20T10:00:00Z'),
      }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;
    const context = registeredContext() as ReviewContext;
    context.auth = {
      subjectId: 'guest-1',
      guestIdentityId: 'guest-1',
      role: 'GUEST',
      deviceId: 'guest-device',
      sessionId: 'guest-session',
      conversationId: 'conversation-1',
    };
    context.participant = {
      ...context.participant,
      userId: null,
      guestIdentityId: 'guest-1',
    };

    await expect(lockAndAssertReviewActor(tx, context)).rejects.toMatchObject({
      code: 'GUEST_TOKEN_REVOKED',
      statusCode: 403,
    });
  });
});

describe('confirmed glossary transaction', () => {
  it('does not upsert when meeting end committed before the glossary transaction lock', async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([{
      id: 'conversation-1',
      ownerId: 'host-1',
      status: 'ENDED',
      expiresAt: new Date('2999-07-20T10:00:00Z'),
    }]);
    const findMessage = vi.fn();
    const findCorrection = vi.fn();
    const upsert = vi.fn();
    const tx = {
      $queryRaw: queryRaw,
      translationMessage: { findUnique: findMessage },
      messageCorrection: { findUnique: findCorrection },
      glossaryTerm: { upsert },
    } as unknown as Prisma.TransactionClient;

    await expect(upsertConfirmedGlossaryTerm(
      tx,
      hostContext(),
      { sourceTerm: '轴承', targetTerm: 'подшипник' },
    )).rejects.toMatchObject({
      code: 'ROOM_NOT_ACTIVE',
      statusCode: 403,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findMessage).not.toHaveBeenCalled();
    expect(findCorrection).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not accept an older confirmed correction when the current revision is pending', async () => {
    const queryRaw = validHostLockQueries();
    const findMessage = vi.fn().mockResolvedValue({
      id: 'message-1',
      conversationId: 'conversation-1',
      status: 'FINAL',
      reviewStatus: 'PENDING',
      reviewRevision: 2,
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
    });
    const findCorrection = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      status: 'CONFIRMED',
    });
    const upsert = vi.fn();
    const tx = {
      $queryRaw: queryRaw,
      translationMessage: { findUnique: findMessage },
      messageCorrection: { findUnique: findCorrection },
      glossaryTerm: { upsert },
    } as unknown as Prisma.TransactionClient;

    await expect(upsertConfirmedGlossaryTerm(
      tx,
      hostContext(),
      { sourceTerm: '轴承', targetTerm: 'подшипник' },
    )).rejects.toMatchObject({
      code: 'MESSAGE_NOT_CONFIRMED',
      statusCode: 409,
    });

    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(findMessage).toHaveBeenCalledOnce();
    expect(findCorrection).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('checks the exact current confirmed revision before the upsert', async () => {
    const queryRaw = validHostLockQueries();
    const findMessage = vi.fn().mockResolvedValue({
      id: 'message-1',
      conversationId: 'conversation-1',
      status: 'FINAL',
      reviewStatus: 'CONFIRMED',
      reviewRevision: 3,
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
    });
    const findCorrection = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      status: 'CONFIRMED',
    });
    const term = { id: 'term-1' };
    const upsert = vi.fn().mockResolvedValue(term);
    const tx = {
      $queryRaw: queryRaw,
      translationMessage: { findUnique: findMessage },
      messageCorrection: { findUnique: findCorrection },
      glossaryTerm: { upsert },
    } as unknown as Prisma.TransactionClient;

    await expect(upsertConfirmedGlossaryTerm(
      tx,
      hostContext(),
      {
        sourceTerm: '轴承',
        targetTerm: 'подшипник',
        category: '零部件',
      },
    )).resolves.toBe(term);

    expect(findCorrection).toHaveBeenCalledWith({
      where: {
        messageId_revision: { messageId: 'message-1', revision: 3 },
      },
      select: { conversationId: true, status: true },
    });
    expect(upsert).toHaveBeenCalledOnce();
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findMessage.mock.invocationCallOrder[0]!,
    );
    expect(findMessage.mock.invocationCallOrder[0]).toBeLessThan(
      findCorrection.mock.invocationCallOrder[0]!,
    );
    expect(findCorrection.mock.invocationCallOrder[0]).toBeLessThan(
      upsert.mock.invocationCallOrder[0]!,
    );
  });
});

function validHostLockQueries() {
  return vi.fn()
    .mockResolvedValueOnce([{
      id: 'conversation-1', ownerId: 'host-1', status: 'ACTIVE',
      expiresAt: new Date('2999-07-20T10:00:00Z'),
    }])
    .mockResolvedValueOnce([{
      id: 'host-1', status: 'ACTIVE',
    }])
    .mockResolvedValueOnce([{ sessionId: 'host-session', revokedAt: null }])
    .mockResolvedValueOnce([{
      id: 'host-participant',
      userId: 'host-1',
      guestIdentityId: null,
      removedAt: null,
      leftAt: null,
      presence: 'ONLINE',
    }]);
}

function hostContext(): ReviewContext {
  return {
    auth: {
      subjectId: 'host-1',
      role: 'USER',
      deviceId: 'host-device',
      sessionId: 'host-session',
    },
    conversation: { ownerId: 'host-1' } as ReviewContext['conversation'],
    participant: {
      id: 'host-participant',
      conversationId: 'conversation-1',
      userId: 'host-1',
      guestIdentityId: null,
      displayName: '主持人',
      company: '中方公司',
    } as ReviewContext['participant'],
    message: {
      id: 'message-1',
      conversationId: 'conversation-1',
      participantId: 'speaker-participant',
      status: 'FINAL',
    } as ReviewContext['message'],
  };
}

function registeredContext(): ReviewContext {
  return {
    auth: {
      subjectId: 'user-1',
      role: 'USER',
      deviceId: 'device-1',
      sessionId: 'session-1',
    },
    conversation: { ownerId: 'host-1' } as ReviewContext['conversation'],
    participant: {
      id: 'participant-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      guestIdentityId: null,
      displayName: 'Ivan',
      company: 'RU Trade',
    } as ReviewContext['participant'],
    message: {
      id: 'message-1',
      conversationId: 'conversation-1',
      participantId: 'participant-1',
      status: 'FINAL',
    } as ReviewContext['message'],
  };
}
