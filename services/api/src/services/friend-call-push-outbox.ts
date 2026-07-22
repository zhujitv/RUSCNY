import type { FriendCallPushKind, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import {
  sendFriendCallPush,
  type FriendCallPushTarget,
} from './fcm-push.js';

const defaultBatchSize = 20;
const defaultIntervalMs = 1_000;
const defaultClaimTimeoutMs = 30_000;
const baseRetryDelayMs = 1_000;
const maximumRetryDelayMs = 15_000;

type FriendCallPushTransaction = Pick<
  Prisma.TransactionClient,
  'friendCallPushJob' | 'userDevice'
>;

interface PushLogger {
  error(bindings: Record<string, unknown>, message: string): unknown;
}

interface ProcessOptions {
  batchSize?: number;
  claimTimeoutMs?: number;
  now?: Date;
}

interface WorkerOptions {
  batchSize?: number;
  claimTimeoutMs?: number;
  intervalMs?: number;
  logger?: PushLogger;
}

export interface FriendCallPushRunResult {
  candidates: number;
  claimed: number;
  delivered: number;
  completed: number;
  retried: number;
  expired: number;
}

export interface FriendCallPushWorker {
  wake(): void;
  stop(): Promise<void>;
}

let activeWorker: FriendCallPushWorker | undefined;

export async function enqueueFriendCallPushJob(
  tx: FriendCallPushTransaction,
  input: {
    callId: string;
    recipientUserId: string;
    kind: FriendCallPushKind;
    expiresAt: Date;
    snapshotRecipientTargets?: boolean;
  },
): Promise<boolean> {
  const { snapshotRecipientTargets = false, ...job } = input;
  if (snapshotRecipientTargets && input.kind !== 'CANCEL') {
    throw new Error('Push target snapshots are restricted to cancellation jobs');
  }
  const targetSnapshot = snapshotRecipientTargets
    ? await snapshotAndroidPushTargets(tx, input.recipientUserId)
    : undefined;
  const result = await tx.friendCallPushJob.createMany({
    data: [{
      ...job,
      ...(targetSnapshot !== undefined
        ? { targetSnapshot: targetSnapshot as unknown as Prisma.InputJsonValue }
        : {}),
    }],
    skipDuplicates: true,
  });
  return result.count === 1;
}

export async function enqueueFriendCallPushJobNow(input: {
  callId: string;
  recipientUserId: string;
  kind: FriendCallPushKind;
  expiresAt: Date;
}): Promise<boolean> {
  const inserted = await enqueueFriendCallPushJob(prisma, input);
  if (inserted) wakeFriendCallPushWorker();
  return inserted;
}

export async function processFriendCallPushJobs(
  options: ProcessOptions = {},
): Promise<FriendCallPushRunResult> {
  const batchSize = options.batchSize ?? defaultBatchSize;
  const claimTimeoutMs = options.claimTimeoutMs ?? defaultClaimTimeoutMs;
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - claimTimeoutMs);
  const candidates = await prisma.friendCallPushJob.findMany({
    where: {
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
    select: {
      id: true,
      callId: true,
      recipientUserId: true,
      kind: true,
      targetSnapshot: true,
      attempts: true,
      expiresAt: true,
    },
  });
  const result: FriendCallPushRunResult = {
    candidates: candidates.length,
    claimed: 0,
    delivered: 0,
    completed: 0,
    retried: 0,
    expired: 0,
  };

  await Promise.all(candidates.map(async (job) => {
    const lockedAt = options.now ?? new Date();
    const claim = await prisma.friendCallPushJob.updateMany({
      where: {
        id: job.id,
        nextAttemptAt: { lte: lockedAt },
        OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
      },
      data: { lockedAt, attempts: { increment: 1 } },
    });
    if (claim.count !== 1) return;
    result.claimed += 1;

    if (job.expiresAt <= lockedAt) {
      await completeJob(job.id, lockedAt);
      result.completed += 1;
      result.expired += 1;
      return;
    }

    try {
      const call = await prisma.friendCall.findUnique({
        where: { id: job.callId },
        select: {
          id: true,
          callerId: true,
          calleeId: true,
          status: true,
          mediaType: true,
          caller: { select: { displayName: true } },
        },
      });
      if (
        !call ||
        (job.kind === 'INCOMING' &&
          (call.status !== 'RINGING' || call.calleeId !== job.recipientUserId)) ||
        (job.kind === 'CANCEL' &&
          (call.status === 'RINGING' || call.calleeId !== job.recipientUserId))
      ) {
        await completeJob(job.id, lockedAt);
        result.completed += 1;
        return;
      }

      const targets = job.kind === 'CANCEL' && job.targetSnapshot !== null
        ? parseTargetSnapshot(job.targetSnapshot)
        : await activeAndroidPushTargets(job.recipientUserId);
      if (targets.length === 0) {
        const retried = await retryJob(
          job.id,
          lockedAt,
          job.attempts + 1,
          job.expiresAt,
          'NO_ACTIVE_ANDROID_PUSH_TARGET',
        );
        if (retried) result.retried += 1;
        else {
          result.completed += 1;
          result.expired += 1;
        }
        return;
      }

      const delivery = await sendFriendCallPush({
        kind: job.kind,
        callId: call.id,
        expiresAt: job.expiresAt,
        ...(job.kind === 'INCOMING'
          ? {
              mediaType: call.mediaType,
              callerDisplayName: call.caller.displayName,
            }
          : {}),
      }, targets);
      result.delivered += delivery.delivered;
      if (delivery.invalidTargets.length > 0) {
        await prisma.userDevice.updateMany({
          where: {
            userId: job.recipientUserId,
            OR: delivery.invalidTargets.map((target) => ({
              pushToken: target.registrationToken,
              pushBindingId: target.bindingId,
            })),
          },
          data: {
            pushToken: null,
            pushBindingId: null,
            pushTokenUpdatedAt: null,
          },
        });
      }
      if (delivery.disabled) {
        const retried = await retryJob(
          job.id,
          lockedAt,
          job.attempts + 1,
          job.expiresAt,
          'PUSH_PROVIDER_DISABLED',
        );
        if (retried) result.retried += 1;
        else {
          result.completed += 1;
          result.expired += 1;
        }
        return;
      }
      if (delivery.retryableFailures > 0) {
        const retried = await retryJob(
          job.id,
          lockedAt,
          job.attempts + 1,
          job.expiresAt,
          `FCM_RETRYABLE_FAILURES:${delivery.retryableFailures}`,
        );
        if (retried) result.retried += 1;
        else {
          result.completed += 1;
          result.expired += 1;
        }
        return;
      }
      await completeJob(job.id, lockedAt);
      result.completed += 1;
    } catch (error) {
      const retried = await retryJob(
        job.id,
        lockedAt,
        job.attempts + 1,
        job.expiresAt,
        pushErrorCode(error),
      );
      if (retried) result.retried += 1;
      else {
        result.completed += 1;
        result.expired += 1;
      }
    }
  }));
  return result;
}

async function snapshotAndroidPushTargets(
  tx: FriendCallPushTransaction,
  recipientUserId: string,
): Promise<FriendCallPushTarget[]> {
  const devices = await tx.userDevice.findMany({
    where: {
      userId: recipientUserId,
      platform: 'ANDROID',
      revokedAt: null,
      pushToken: { not: null },
      pushBindingId: { not: null },
    },
    select: { pushToken: true, pushBindingId: true },
  });
  return pushTargetsFromDevices(devices);
}

async function activeAndroidPushTargets(
  recipientUserId: string,
): Promise<FriendCallPushTarget[]> {
  const devices = await prisma.userDevice.findMany({
    where: {
      userId: recipientUserId,
      platform: 'ANDROID',
      revokedAt: null,
      pushToken: { not: null },
      pushBindingId: { not: null },
      user: { status: 'ACTIVE' },
    },
    select: { pushToken: true, pushBindingId: true },
  });
  return pushTargetsFromDevices(devices);
}

function pushTargetsFromDevices(devices: Array<{
  pushToken: string | null;
  pushBindingId: string | null;
}>): FriendCallPushTarget[] {
  return devices.flatMap((device) =>
    device.pushToken && device.pushBindingId
      ? [{ registrationToken: device.pushToken, bindingId: device.pushBindingId }]
      : []);
}

function parseTargetSnapshot(value: Prisma.JsonValue): FriendCallPushTarget[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const registrationToken = candidate.registrationToken;
    const bindingId = candidate.bindingId;
    if (
      typeof registrationToken !== 'string' ||
      registrationToken.length < 20 ||
      registrationToken.length > 4_096 ||
      typeof bindingId !== 'string' ||
      bindingId.length < 1 ||
      bindingId.length > 200
    ) return [];
    return [{ registrationToken, bindingId }];
  });
}

export function startFriendCallPushWorker(options: WorkerOptions = {}): FriendCallPushWorker {
  const intervalMs = options.intervalMs ?? defaultIntervalMs;
  const batchSize = options.batchSize ?? defaultBatchSize;
  let stopped = false;
  let runAgain = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  const schedule = (delay: number): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      runAgain = true;
      return running;
    }
    if (timer) clearTimeout(timer);
    timer = undefined;
    running = (async () => {
      do {
        runAgain = false;
        const batch = await processFriendCallPushJobs({
          batchSize,
          claimTimeoutMs: options.claimTimeoutMs,
        });
        if (batch.claimed === batchSize) runAgain = true;
      } while (runAgain && !stopped);
    })()
      .catch((error: unknown) => {
        options.logger?.error(
          { errorCode: pushErrorCode(error) },
          'friend call push outbox worker failed',
        );
      })
      .finally(() => {
        running = undefined;
        if (!stopped) schedule(intervalMs);
      });
    return running;
  };

  const worker: FriendCallPushWorker = {
    wake() {
      if (stopped) return;
      if (running) {
        runAgain = true;
        return;
      }
      schedule(0);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await running;
      if (activeWorker === worker) activeWorker = undefined;
    },
  };
  activeWorker = worker;
  worker.wake();
  return worker;
}

export function wakeFriendCallPushWorker(): void {
  activeWorker?.wake();
}

async function completeJob(id: string, lockedAt: Date): Promise<void> {
  await prisma.friendCallPushJob.deleteMany({ where: { id, lockedAt } });
}

async function retryJob(
  id: string,
  lockedAt: Date,
  attempt: number,
  expiresAt: Date,
  errorCode: string,
): Promise<boolean> {
  const nextAttemptAt = new Date(lockedAt.getTime() + retryDelayMs(attempt));
  if (nextAttemptAt >= expiresAt) {
    await completeJob(id, lockedAt);
    return false;
  }
  const released = await prisma.friendCallPushJob.updateMany({
    where: { id, lockedAt },
    data: {
      lockedAt: null,
      lastError: errorCode.slice(0, 200),
      nextAttemptAt,
    },
  });
  return released.count === 1;
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 10));
  return Math.min(maximumRetryDelayMs, baseRetryDelayMs * 2 ** exponent);
}

function pushErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN_PUSH_ERROR';
  const candidate = error as { name?: unknown; code?: unknown };
  const name = typeof candidate.name === 'string' ? candidate.name : 'PushError';
  const code = typeof candidate.code === 'string' && /^[A-Za-z0-9/_-]{1,100}$/.test(candidate.code)
    ? candidate.code
    : 'UNKNOWN';
  return `${name}:${code}`;
}
