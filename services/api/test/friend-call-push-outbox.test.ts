import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendFriendCallPush: vi.fn(),
  prisma: {
    friendCallPushJob: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    friendCall: { findUnique: vi.fn() },
    userDevice: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));
vi.mock('../src/services/fcm-push.js', () => ({
  sendFriendCallPush: mocks.sendFriendCallPush,
}));

import {
  enqueueFriendCallPushJob,
  processFriendCallPushJobs,
} from '../src/services/friend-call-push-outbox.js';

const now = new Date('2026-07-22T10:00:00.000Z');
const dueJob = {
  id: 'job-a',
  callId: 'call-a',
  recipientUserId: 'callee-a',
  kind: 'INCOMING',
  targetSnapshot: null,
  attempts: 0,
  expiresAt: new Date(now.getTime() + 60_000),
};
const ringingCall = {
  id: 'call-a',
  callerId: 'caller-a',
  calleeId: 'callee-a',
  status: 'RINGING',
  mediaType: 'AUDIO',
  caller: { displayName: 'Caller' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.friendCallPushJob.findMany.mockResolvedValue([dueJob]);
  mocks.prisma.friendCallPushJob.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.friendCallPushJob.deleteMany.mockResolvedValue({ count: 1 });
  mocks.prisma.friendCall.findUnique.mockResolvedValue(ringingCall);
  mocks.prisma.userDevice.findMany.mockResolvedValue([{
    pushToken: 'token-a',
    pushBindingId: 'binding-a',
  }]);
  mocks.prisma.userDevice.updateMany.mockResolvedValue({ count: 0 });
  mocks.sendFriendCallPush.mockResolvedValue({
    attempted: 1,
    delivered: 1,
    invalidTargets: [],
    retryableFailures: 0,
    disabled: false,
  });
});

describe('friend-call push durable outbox', () => {
  it('enqueues one subject-level job idempotently', async () => {
    mocks.prisma.friendCallPushJob.createMany.mockResolvedValue({ count: 1 });

    await expect(enqueueFriendCallPushJob(mocks.prisma as never, {
      callId: 'call-a',
      recipientUserId: 'callee-a',
      kind: 'INCOMING',
      expiresAt: dueJob.expiresAt,
    })).resolves.toBe(true);

    expect(mocks.prisma.friendCallPushJob.createMany).toHaveBeenCalledWith({
      data: [{
        callId: 'call-a',
        recipientUserId: 'callee-a',
        kind: 'INCOMING',
        expiresAt: dueJob.expiresAt,
      }],
      skipDuplicates: true,
    });
  });

  it('snapshots the retiring callee targets into the short-lived cancel job', async () => {
    mocks.prisma.friendCallPushJob.createMany.mockResolvedValue({ count: 1 });
    mocks.prisma.userDevice.findMany.mockResolvedValue([
      {
        pushToken: 'retiring-device-token-a',
        pushBindingId: 'retiring-binding-a',
      },
      { pushToken: null, pushBindingId: 'incomplete-binding' },
    ]);

    await expect(enqueueFriendCallPushJob(mocks.prisma as never, {
      callId: 'call-a',
      recipientUserId: 'callee-a',
      kind: 'CANCEL',
      expiresAt: dueJob.expiresAt,
      snapshotRecipientTargets: true,
    })).resolves.toBe(true);

    expect(mocks.prisma.userDevice.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'callee-a',
        platform: 'ANDROID',
        revokedAt: null,
        pushToken: { not: null },
        pushBindingId: { not: null },
      },
      select: { pushToken: true, pushBindingId: true },
    });
    expect(mocks.prisma.friendCallPushJob.createMany).toHaveBeenCalledWith({
      data: [{
        callId: 'call-a',
        recipientUserId: 'callee-a',
        kind: 'CANCEL',
        expiresAt: dueJob.expiresAt,
        targetSnapshot: [{
          registrationToken: 'retiring-device-token-a',
          bindingId: 'retiring-binding-a',
        }],
      }],
      skipDuplicates: true,
    });
  });

  it('rejects target snapshots on incoming-call jobs', async () => {
    await expect(enqueueFriendCallPushJob(mocks.prisma as never, {
      callId: 'call-a',
      recipientUserId: 'callee-a',
      kind: 'INCOMING',
      expiresAt: dueJob.expiresAt,
      snapshotRecipientTargets: true,
    })).rejects.toThrow('restricted to cancellation jobs');

    expect(mocks.prisma.userDevice.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.friendCallPushJob.createMany).not.toHaveBeenCalled();
  });

  it('drops a stale incoming job after consulting authoritative call state', async () => {
    mocks.prisma.friendCall.findUnique.mockResolvedValue({
      ...ringingCall,
      status: 'CANCELLED',
    });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ claimed: 1, completed: 1, delivered: 0 });
    expect(mocks.sendFriendCallPush).not.toHaveBeenCalled();
    expect(mocks.prisma.friendCallPushJob.deleteMany).toHaveBeenCalledWith({
      where: { id: 'job-a', lockedAt: now },
    });
  });

  it('sends to every active Android token and clears invalid registrations', async () => {
    mocks.prisma.userDevice.findMany.mockResolvedValue([
      { pushToken: 'valid-token', pushBindingId: 'binding-valid' },
      { pushToken: 'invalid-token', pushBindingId: 'binding-invalid' },
      { pushToken: 'missing-binding', pushBindingId: null },
      { pushToken: null, pushBindingId: 'missing-token-binding' },
    ]);
    mocks.sendFriendCallPush.mockResolvedValue({
      attempted: 2,
      delivered: 1,
      invalidTargets: [{
        registrationToken: 'invalid-token',
        bindingId: 'binding-invalid',
      }],
      retryableFailures: 0,
      disabled: false,
    });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ delivered: 1, completed: 1, retried: 0 });
    expect(mocks.sendFriendCallPush).toHaveBeenCalledWith({
      kind: 'INCOMING',
      callId: 'call-a',
      expiresAt: dueJob.expiresAt,
      mediaType: 'AUDIO',
      callerDisplayName: 'Caller',
    }, [
      { registrationToken: 'valid-token', bindingId: 'binding-valid' },
      { registrationToken: 'invalid-token', bindingId: 'binding-invalid' },
    ]);
    expect(mocks.prisma.userDevice.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'callee-a',
        platform: 'ANDROID',
        revokedAt: null,
        pushToken: { not: null },
        pushBindingId: { not: null },
        user: { status: 'ACTIVE' },
      },
      select: { pushToken: true, pushBindingId: true },
    });
    expect(mocks.prisma.userDevice.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'callee-a',
        OR: [{
          pushToken: 'invalid-token',
          pushBindingId: 'binding-invalid',
        }],
      },
      data: {
        pushToken: null,
        pushBindingId: null,
        pushTokenUpdatedAt: null,
      },
    });
  });

  it('releases a transient failure for a bounded retry', async () => {
    mocks.sendFriendCallPush.mockResolvedValue({
      attempted: 1,
      delivered: 0,
      invalidTargets: [],
      retryableFailures: 1,
      disabled: false,
    });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ claimed: 1, retried: 1, completed: 0 });
    expect(mocks.prisma.friendCallPushJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'job-a', lockedAt: now },
      data: {
        lockedAt: null,
        lastError: 'FCM_RETRYABLE_FAILURES:1',
        nextAttemptAt: new Date(now.getTime() + 1_000),
      },
    });
  });

  it('retries a disabled provider until the durable job expiry', async () => {
    mocks.sendFriendCallPush.mockResolvedValue({
      attempted: 1,
      delivered: 0,
      invalidTargets: [],
      retryableFailures: 0,
      disabled: true,
    });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ claimed: 1, retried: 1, completed: 0 });
    expect(mocks.prisma.friendCallPushJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'job-a', lockedAt: now },
      data: {
        lockedAt: null,
        lastError: 'PUSH_PROVIDER_DISABLED',
        nextAttemptAt: new Date(now.getTime() + 1_000),
      },
    });
  });

  it('bounds disabled-provider retries by deleting a job before a late next attempt', async () => {
    mocks.prisma.friendCallPushJob.findMany.mockResolvedValue([{
      ...dueJob,
      expiresAt: new Date(now.getTime() + 500),
    }]);
    mocks.sendFriendCallPush.mockResolvedValue({
      attempted: 1,
      delivered: 0,
      invalidTargets: [],
      retryableFailures: 0,
      disabled: true,
    });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ claimed: 1, retried: 0, completed: 1, expired: 1 });
    expect(mocks.prisma.friendCallPushJob.deleteMany).toHaveBeenCalledWith({
      where: { id: 'job-a', lockedAt: now },
    });
  });

  it('sends cancellation only to the callee after the call leaves ringing state', async () => {
    mocks.prisma.friendCallPushJob.findMany.mockResolvedValue([{
      ...dueJob,
      kind: 'CANCEL',
    }]);
    mocks.prisma.friendCall.findUnique.mockResolvedValue({
      ...ringingCall,
      status: 'ACTIVE',
    });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ claimed: 1, delivered: 1, completed: 1 });
    expect(mocks.sendFriendCallPush).toHaveBeenCalledWith({
      kind: 'CANCEL',
      callId: 'call-a',
      expiresAt: dueJob.expiresAt,
    }, [{ registrationToken: 'token-a', bindingId: 'binding-a' }]);
  });

  it('uses the cancel snapshot after the callee account and device are retired', async () => {
    mocks.prisma.friendCallPushJob.findMany.mockResolvedValue([{
      ...dueJob,
      kind: 'CANCEL',
      targetSnapshot: [{
        registrationToken: 'retiring-device-token-a',
        bindingId: 'retiring-binding-a',
      }],
    }]);
    mocks.prisma.friendCall.findUnique.mockResolvedValue({
      ...ringingCall,
      status: 'ENDED',
    });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ claimed: 1, delivered: 1, completed: 1 });
    expect(mocks.prisma.userDevice.findMany).not.toHaveBeenCalled();
    expect(mocks.sendFriendCallPush).toHaveBeenCalledWith({
      kind: 'CANCEL',
      callId: 'call-a',
      expiresAt: dueJob.expiresAt,
    }, [{
      registrationToken: 'retiring-device-token-a',
      bindingId: 'retiring-binding-a',
    }]);
    expect(mocks.prisma.friendCallPushJob.deleteMany).toHaveBeenCalledWith({
      where: { id: 'job-a', lockedAt: now },
    });
  });

  it.each([
    { recipientUserId: 'caller-a', status: 'ENDED' },
    { recipientUserId: 'callee-a', status: 'RINGING' },
  ])('drops an unauthorized cancellation target %#', async ({ recipientUserId, status }) => {
    mocks.prisma.friendCallPushJob.findMany.mockResolvedValue([{
      ...dueJob,
      kind: 'CANCEL',
      recipientUserId,
      targetSnapshot: [{
        registrationToken: 'retiring-device-token-a',
        bindingId: 'retiring-binding-a',
      }],
    }]);
    mocks.prisma.friendCall.findUnique.mockResolvedValue({ ...ringingCall, status });

    const result = await processFriendCallPushJobs({ now });

    expect(result).toMatchObject({ claimed: 1, completed: 1, delivered: 0 });
    expect(mocks.sendFriendCallPush).not.toHaveBeenCalled();
  });
});
