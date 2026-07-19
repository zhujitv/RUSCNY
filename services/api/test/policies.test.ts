import { describe, expect, it } from 'vitest';
import {
  conversationScopeMatches,
  guestHistoryAllowed,
  historyExpiresAt,
} from '../src/policies.js';

describe('conversation history policy', () => {
  const endedAt = new Date('2026-07-18T10:00:00.000Z');

  it('calculates each finite history window from the actual end time', () => {
    expect(historyExpiresAt('NO_ACCESS_AFTER_END', endedAt)).toEqual(endedAt);
    expect(historyExpiresAt('ACCESS_FOR_24_HOURS', endedAt)).toEqual(
      new Date('2026-07-19T10:00:00.000Z'),
    );
    expect(historyExpiresAt('ACCESS_FOR_7_DAYS', endedAt)).toEqual(
      new Date('2026-07-25T10:00:00.000Z'),
    );
    expect(historyExpiresAt('PERMANENT', endedAt)).toBeNull();
  });

  it('allows a participant before expiry and denies at the exact expiry boundary', () => {
    const conversation = {
      status: 'ENDED' as const,
      guestHistoryPolicy: 'ACCESS_FOR_24_HOURS' as const,
      guestAccessExpiresAt: new Date('2026-07-19T10:00:00.000Z'),
    };

    expect(
      guestHistoryAllowed(conversation, new Date('2026-07-19T09:59:59.999Z')),
    ).toBe(true);
    expect(
      guestHistoryAllowed(conversation, new Date('2026-07-19T10:00:00.000Z')),
    ).toBe(false);
  });

  it('honours no-access and permanent policies after a meeting ends', () => {
    expect(
      guestHistoryAllowed({
        status: 'ENDED',
        guestHistoryPolicy: 'NO_ACCESS_AFTER_END',
        guestAccessExpiresAt: endedAt,
      }),
    ).toBe(false);

    expect(
      guestHistoryAllowed({
        status: 'ENDED',
        guestHistoryPolicy: 'PERMANENT',
        guestAccessExpiresAt: null,
      }),
    ).toBe(true);
  });

  it('denies expired rooms while allowing active and waiting rooms', () => {
    for (const status of ['WAITING', 'ACTIVE'] as const) {
      expect(
        guestHistoryAllowed({
          status,
          guestHistoryPolicy: 'NO_ACCESS_AFTER_END',
          guestAccessExpiresAt: null,
        }),
      ).toBe(true);
    }
    expect(
      guestHistoryAllowed({
        status: 'EXPIRED',
        guestHistoryPolicy: 'PERMANENT',
        guestAccessExpiresAt: null,
      }),
    ).toBe(false);
  });
});

describe('conversation scope isolation', () => {
  const conversation = { id: 'conversation-a', ownerId: 'host-a' };

  it('leaves registered-user membership enforcement to participant lookup', () => {
    expect(
      conversationScopeMatches(
        { subjectId: 'host-a', role: 'USER', deviceId: 'device-a' },
        conversation,
      ),
    ).toBe(true);
    expect(
      conversationScopeMatches(
        { subjectId: 'host-b', role: 'USER', deviceId: 'device-b' },
        conversation,
      ),
    ).toBe(true);
  });

  it('binds guest tokens to exactly one conversation', () => {
    expect(
      conversationScopeMatches(
        {
          subjectId: 'guest-a',
          role: 'GUEST',
          deviceId: 'guest-device',
          conversationId: 'conversation-a',
        },
        conversation,
      ),
    ).toBe(true);
    expect(
      conversationScopeMatches(
        {
          subjectId: 'guest-a',
          role: 'GUEST',
          deviceId: 'guest-device',
          conversationId: 'conversation-b',
        },
        conversation,
      ),
    ).toBe(false);
  });

  it('leaves customer membership enforcement to the participant lookup', () => {
    expect(
      conversationScopeMatches(
        { subjectId: 'customer-a', role: 'USER', deviceId: 'customer-device' },
        conversation,
      ),
    ).toBe(true);
  });
});
