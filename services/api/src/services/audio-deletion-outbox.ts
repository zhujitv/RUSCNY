import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { deleteTtsAsset, isStoredTtsAsset } from './audio-assets.js';

const defaultBatchSize = 20;
const defaultIntervalMs = 15_000;
const defaultClaimTimeoutMs = 5 * 60_000;
const baseRetryDelayMs = 5_000;
const maximumRetryDelayMs = 60 * 60_000;

type AudioDeletionTransaction = Pick<Prisma.TransactionClient, 'audioDeletionJob'>;

interface AudioDeletionLogger {
  error(bindings: Record<string, unknown>, message: string): unknown;
}

export interface AudioDeletionRunResult {
  candidates: number;
  claimed: number;
  deleted: number;
  failed: number;
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
  logger?: AudioDeletionLogger;
}

export interface AudioDeletionWorker {
  wake(): void;
  stop(): Promise<void>;
}

let activeWorker: AudioDeletionWorker | undefined;

/**
 * Add object deletion work to the caller's database transaction. The values
 * are deliberately stored without a relation to TranslationMessage so the
 * queue rows survive the conversation cascade delete.
 */
export async function enqueueAudioDeletionJobs(
  tx: AudioDeletionTransaction,
  storedValues: Array<string | null>,
): Promise<number> {
  const values = [...new Set(storedValues.filter(isStoredTtsAsset))];
  if (!values.length) return 0;
  const result = await tx.audioDeletionJob.createMany({
    data: values.map((storedValue) => ({ storedValue })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Persist cleanup for an asset that was created outside a database
 * transaction but never became part of a committed message. This is the
 * fallback used when the immediate best-effort object deletion also fails.
 */
export async function enqueueAudioDeletionJobsNow(
  storedValues: Array<string | null>,
): Promise<number> {
  const queued = await enqueueAudioDeletionJobs(prisma, storedValues);
  if (queued > 0) wakeAudioDeletionWorker();
  return queued;
}

/**
 * Process one due batch. Claims use compare-and-swap updates, allowing many
 * API instances to run workers without processing a live claim twice. A claim
 * older than claimTimeoutMs is recoverable after a process crash.
 */
export async function processAudioDeletionJobs(
  options: ProcessOptions = {},
): Promise<AudioDeletionRunResult> {
  const batchSize = options.batchSize ?? defaultBatchSize;
  const claimTimeoutMs = options.claimTimeoutMs ?? defaultClaimTimeoutMs;
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - claimTimeoutMs);
  const candidates = await prisma.audioDeletionJob.findMany({
    where: {
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
    select: { id: true, storedValue: true, attempts: true },
  });

  const result: AudioDeletionRunResult = {
    candidates: candidates.length,
    claimed: 0,
    deleted: 0,
    failed: 0,
  };

  await Promise.all(candidates.map(async (job) => {
    const lockedAt = new Date();
    const claim = await prisma.audioDeletionJob.updateMany({
      where: {
        id: job.id,
        nextAttemptAt: { lte: lockedAt },
        OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
      },
      data: {
        lockedAt,
        attempts: { increment: 1 },
      },
    });
    if (claim.count !== 1) return;
    result.claimed += 1;

    try {
      await deleteTtsAsset(job.storedValue);
      await prisma.audioDeletionJob.deleteMany({
        where: { id: job.id, lockedAt },
      });
      result.deleted += 1;
    } catch (error) {
      const attempt = job.attempts + 1;
      await prisma.audioDeletionJob.updateMany({
        where: { id: job.id, lockedAt },
        data: {
          lockedAt: null,
          lastError: deletionErrorMessage(error),
          nextAttemptAt: new Date(lockedAt.getTime() + retryDelayMs(attempt)),
        },
      });
      result.failed += 1;
    }
  }));

  return result;
}

export function startAudioDeletionWorker(options: WorkerOptions = {}): AudioDeletionWorker {
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
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    running = (async () => {
      do {
        runAgain = false;
        const result = await processAudioDeletionJobs({
          batchSize,
          claimTimeoutMs: options.claimTimeoutMs,
        });
        // Drain immediately when a full batch was claimed; otherwise use the
        // normal interval unless wake() was called while this batch ran.
        if (result.claimed === batchSize) runAgain = true;
      } while (runAgain && !stopped);
    })()
      .catch((error: unknown) => {
        options.logger?.error(
          { error: deletionErrorMessage(error) },
          'audio deletion outbox worker failed',
        );
      })
      .finally(() => {
        running = undefined;
        if (!stopped) schedule(intervalMs);
      });
    return running;
  };

  const worker: AudioDeletionWorker = {
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

/** Wake the server-owned worker after an outbox transaction commits. */
export function wakeAudioDeletionWorker(): void {
  activeWorker?.wake();
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 20));
  return Math.min(maximumRetryDelayMs, baseRetryDelayMs * 2 ** exponent);
}

function deletionErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : 'Unknown audio deletion error';
  return message.slice(0, 1_000);
}
