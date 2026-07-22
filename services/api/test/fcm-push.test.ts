import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    PUSH_PROVIDER: 'fcm',
    ANDROID_PACKAGE_NAME: 'com.tooyei.translator',
    FCM_PROJECT_ID: 'project-a',
    FCM_CLIENT_EMAIL: 'push@example.test',
    FCM_PRIVATE_KEY: 'private-key-value-that-is-long-enough',
  },
}));

vi.mock('../src/config.js', () => ({ config: mocks.config }));

import { sendFriendCallPush } from '../src/services/fcm-push.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.PUSH_PROVIDER = 'fcm';
});

describe('FCM friend-call wire contract', () => {
  it('sends an incoming call as high-priority data only', async () => {
    const sendEach = vi.fn(async () => ({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'message-a' }],
    }));
    const expiresAt = new Date(Date.now() + 60_000);

    await expect(sendFriendCallPush({
      kind: 'INCOMING',
      callId: 'call-a',
      mediaType: 'VIDEO',
      callerDisplayName: 'Marc',
      expiresAt,
    }, [{
      registrationToken: 'token-a',
      bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
    }], { sendEach } as never)).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      invalidTargets: [],
      retryableFailures: 0,
      disabled: false,
    });

    expect(sendEach).toHaveBeenCalledWith([
      {
        token: 'token-a',
        data: {
          schemaVersion: '1',
          event: 'friend.call.incoming',
          callId: 'call-a',
          mediaType: 'VIDEO',
          callerDisplayName: 'Marc',
          expiresAt: String(expiresAt.getTime()),
          bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
        },
        android: {
          priority: 'high',
          ttl: expect.any(Number),
          collapseKey: 'call-a',
          restrictedPackageName: 'com.tooyei.translator',
        },
      },
    ]);
    const sent = sendEach.mock.calls[0]![0][0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('notification');
  });

  it('uses the fixed minimal cancel event and deduplicates targets', async () => {
    const sendEach = vi.fn(async () => ({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'message-a' }],
    }));

    await sendFriendCallPush({
      kind: 'CANCEL',
      callId: 'call-a',
      expiresAt: new Date(Date.now() + 60_000),
    }, [
      {
        registrationToken: 'token-a',
        bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
      },
      {
        registrationToken: 'token-a',
        bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
      },
    ], { sendEach } as never);

    expect(sendEach.mock.calls[0]![0]).toHaveLength(1);
    expect(sendEach.mock.calls[0]![0][0].data).toEqual({
      schemaVersion: '1',
      event: 'friend.call.cancel',
      callId: 'call-a',
      bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
    });
    expect(sendEach.mock.calls[0]![0][0].token).toBe('token-a');
  });

  it('separates invalid registrations from retryable provider failures', async () => {
    const sendEach = vi.fn(async () => ({
      successCount: 0,
      failureCount: 2,
      responses: [
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
        {
          success: false,
          error: { code: 'messaging/server-unavailable' },
        },
      ],
    }));

    const result = await sendFriendCallPush({
      kind: 'CANCEL',
      callId: 'call-a',
      expiresAt: new Date(Date.now() + 60_000),
    }, [
      {
        registrationToken: 'invalid-token',
        bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
      },
      {
        registrationToken: 'retry-token',
        bindingId: '3b9dd571-6d6a-493f-8988-0ac4caf75b82',
      },
    ], { sendEach } as never);

    expect(result).toEqual({
      attempted: 2,
      delivered: 0,
      invalidTargets: [{
        registrationToken: 'invalid-token',
        bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
      }],
      retryableFailures: 1,
      disabled: false,
    });
  });

  it('reports disabled delivery without consuming the target as a success', async () => {
    mocks.config.PUSH_PROVIDER = 'disabled';
    const sendEach = vi.fn();

    await expect(sendFriendCallPush({
      kind: 'CANCEL',
      callId: 'call-a',
      expiresAt: new Date(Date.now() + 60_000),
    }, [{
      registrationToken: 'token-a',
      bindingId: '06927bcd-9b16-4480-a031-33fbb4a84732',
    }], { sendEach } as never)).resolves.toEqual({
      attempted: 1,
      delivered: 0,
      invalidTargets: [],
      retryableFailures: 0,
      disabled: true,
    });
    expect(sendEach).not.toHaveBeenCalled();
  });
});
