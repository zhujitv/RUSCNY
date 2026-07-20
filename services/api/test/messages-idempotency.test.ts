import { Prisma, type TranslationMessage } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  assertConversationActiveLocked,
  assertMessageAuthorizationLocked,
  assertParticipantCanSpeak,
  assertParticipantActiveLocked,
  PROCESSING_LEASE_MS,
  shouldBroadcastTranslationFailure,
  shouldClaimMessage,
} from '../src/routes/messages.js';
import { AppError } from '../src/errors.js';

type LeaseMessage = Pick<TranslationMessage, 'status' | 'updatedAt'>;

describe('translation message processing lease', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');

  it('retries FAILED while preserving the existing message record', () => {
    const failed: LeaseMessage = { status: 'FAILED', updatedAt: now };

    expect(shouldClaimMessage(failed, now)).toBe(true);
  });

  it('returns an active PROCESSING attempt without stealing its lease', () => {
    const active: LeaseMessage = {
      status: 'PROCESSING',
      updatedAt: new Date(now.getTime() - PROCESSING_LEASE_MS + 1),
    };

    expect(shouldClaimMessage(active, now)).toBe(false);
  });

  it('allows a PROCESSING attempt to be claimed at the stale boundary', () => {
    const stale: LeaseMessage = {
      status: 'PROCESSING',
      updatedAt: new Date(now.getTime() - PROCESSING_LEASE_MS),
    };

    expect(shouldClaimMessage(stale, now)).toBe(true);
  });

  it('always returns FINAL idempotently', () => {
    const finalMessage: LeaseMessage = {
      status: 'FINAL',
      updatedAt: new Date(0),
    };

    expect(shouldClaimMessage(finalMessage, now)).toBe(false);
  });
});

describe('participant row guard before retry or FINAL', () => {
  it('accepts an active participant selected FOR UPDATE', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{
        removedAt: null,
        leftAt: null,
        presence: 'ONLINE',
        role: 'GUEST',
        displayName: 'Ivan',
        company: null,
        preferredLanguage: 'ru',
      }]),
    } as unknown as Prisma.TransactionClient;

    await expect(
      assertParticipantActiveLocked(tx, 'conversation-1', 'participant-1'),
    ).resolves.toMatchObject({ displayName: 'Ivan', preferredLanguage: 'ru' });
  });

  it.each([[{ removedAt: new Date() }], []])(
    'rejects a removed or missing participant',
    async (...rows) => {
      const tx = { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as Prisma.TransactionClient;
      await expect(
        assertParticipantActiveLocked(tx, 'conversation-1', 'participant-1'),
      ).rejects.toMatchObject({ code: 'PARTICIPANT_REMOVED', statusCode: 403 });
    },
  );
});

describe('conversation row guard before FINAL', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');

  it('accepts an ACTIVE, unexpired row selected FOR UPDATE', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { status: 'ACTIVE', expiresAt: new Date(now.getTime() + 60_000) },
    ]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(assertConversationActiveLocked(tx, 'conversation-1', now)).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it.each([
    ['ENDED', new Date(now.getTime() + 60_000)],
    ['EXPIRED', new Date(now.getTime() + 60_000)],
    ['ACTIVE', now],
  ])('rejects status %s or an expired row', async (status, expiresAt) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ status, expiresAt }]),
    } as unknown as Prisma.TransactionClient;

    await expect(assertConversationActiveLocked(tx, 'conversation-1', now)).rejects.toMatchObject({
      code: 'ROOM_NOT_ACTIVE',
      statusCode: 403,
    });
  });

  it('rejects a missing Conversation row', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as Prisma.TransactionClient;

    await expect(assertConversationActiveLocked(tx, 'missing', now)).rejects.toMatchObject({
      code: 'ROOM_NOT_ACTIVE',
    });
  });
});

describe('speech lifecycle rules', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');
  const future = new Date(now.getTime() + 60_000);

  it('allows the host to speak before another participant joins', () => {
    expect(() => assertParticipantCanSpeak('WAITING', 'HOST', future, now)).not.toThrow();
  });

  it('keeps a waiting guest read-only and rejects ended rooms', () => {
    expect(() => assertParticipantCanSpeak('WAITING', 'GUEST', future, now)).toThrowError(
      expect.objectContaining({ code: 'ROOM_NOT_ACTIVE', statusCode: 403 }),
    );
    expect(() => assertParticipantCanSpeak('ENDED', 'HOST', future, now)).toThrowError(
      expect.objectContaining({ code: 'ROOM_NOT_ACTIVE', statusCode: 403 }),
    );
  });
});

describe('FINAL authorization revalidation', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');
  const activeConversation = {
    status: 'ACTIVE',
    expiresAt: new Date(now.getTime() + 60_000),
  };

  it('locks and validates registered account, device session, then participant', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([activeConversation])
      .mockResolvedValueOnce([{ id: 'user-a', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ sessionId: 'session-a', revokedAt: null }])
      .mockResolvedValueOnce([{
        removedAt: null,
        leftAt: null,
        presence: 'ONLINE',
        role: 'GUEST',
        displayName: 'User A',
        company: null,
        preferredLanguage: 'zh',
        userId: 'user-a',
        guestIdentityId: null,
      }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(assertMessageAuthorizationLocked(
      tx,
      'conversation-a',
      'participant-a',
      {
        subjectId: 'user-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      now,
    )).resolves.toMatchObject({ userId: 'user-a', role: 'GUEST' });
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('uses the locked HOST participant role to allow speech in WAITING', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        status: 'WAITING',
        expiresAt: new Date(now.getTime() + 60_000),
      }])
      .mockResolvedValueOnce([{ id: 'host-a', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ sessionId: 'session-a', revokedAt: null }])
      .mockResolvedValueOnce([{
        removedAt: null,
        leftAt: null,
        presence: 'ONLINE',
        role: 'HOST',
        displayName: 'Host A',
        company: 'Host Company',
        preferredLanguage: 'zh',
        userId: 'host-a',
        guestIdentityId: null,
      }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(assertMessageAuthorizationLocked(
      tx,
      'conversation-a',
      'participant-host',
      {
        subjectId: 'host-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      now,
    )).resolves.toMatchObject({ role: 'HOST', userId: 'host-a' });
  });

  it('rejects a device revoked while an external provider call was in flight', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([activeConversation])
      .mockResolvedValueOnce([{ id: 'user-a', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ sessionId: 'session-a', revokedAt: now }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(assertMessageAuthorizationLocked(
      tx,
      'conversation-a',
      'participant-a',
      {
        subjectId: 'user-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      now,
    )).rejects.toMatchObject({ code: 'DEVICE_REVOKED', statusCode: 401 });
    // The terminal writer refuses before it can even lock/commit a message as
    // this participant.
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('rejects an expired guest generation before locking its participant', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([activeConversation])
      .mockResolvedValueOnce([{
        id: 'guest-a',
        sessionId: 'guest-session-a',
        deviceId: 'guest-device-a',
        conversationId: 'conversation-a',
        expiresAt: now,
        revokedAt: null,
      }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(assertMessageAuthorizationLocked(
      tx,
      'conversation-a',
      'participant-a',
      {
        subjectId: 'guest-a',
        guestIdentityId: 'guest-a',
        conversationId: 'conversation-a',
        role: 'GUEST',
        deviceId: 'guest-device-a',
        sessionId: 'guest-session-a',
      },
      now,
    )).rejects.toMatchObject({ code: 'GUEST_TOKEN_REVOKED', statusCode: 401 });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('does not broadcast any translation failure to the meeting room', () => {
    expect(shouldBroadcastTranslationFailure(
      new AppError(401, 'DEVICE_REVOKED', '已撤销'),
    )).toBe(false);
    expect(shouldBroadcastTranslationFailure(
      new AppError(502, 'MT_FAILED', '翻译失败'),
    )).toBe(false);
  });
});
