import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteTtsAsset: vi.fn(),
  audioDeletionJob: {
    createMany: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../src/db.js', () => ({
  prisma: { audioDeletionJob: mocks.audioDeletionJob },
}));
vi.mock('../src/services/audio-assets.js', () => ({
  deleteTtsAsset: mocks.deleteTtsAsset,
  isStoredTtsAsset: (value: string | null) =>
    typeof value === 'string' && /^asset:tts-[0-9a-f-]+\.(mp3|wav|ogg|aac|m4a)$/.test(value),
}));

import {
  enqueueAudioDeletionJobs,
  enqueueAudioDeletionJobsNow,
  processAudioDeletionJobs,
} from '../src/services/audio-deletion-outbox.js';

const storedAsset = 'asset:tts-123e4567-e89b-12d3-a456-426614174000.mp3';
const now = new Date('2026-07-19T08:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  mocks.audioDeletionJob.createMany.mockResolvedValue({ count: 1 });
  mocks.audioDeletionJob.findMany.mockResolvedValue([]);
  mocks.audioDeletionJob.updateMany.mockResolvedValue({ count: 1 });
  mocks.audioDeletionJob.deleteMany.mockResolvedValue({ count: 1 });
  mocks.deleteTtsAsset.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('audio deletion outbox', () => {
  it('persists only unique managed audio values in the caller transaction', async () => {
    const transaction = { audioDeletionJob: mocks.audioDeletionJob };

    const count = await enqueueAudioDeletionJobs(
      transaction as never,
      [storedAsset, storedAsset, null, 'https://legacy.example/audio.mp3', 'asset:invalid'],
    );

    expect(count).toBe(1);
    expect(mocks.audioDeletionJob.createMany).toHaveBeenCalledWith({
      data: [{ storedValue: storedAsset }],
      skipDuplicates: true,
    });
  });

  it('durably queues an uncommitted asset after direct cleanup fails', async () => {
    await expect(enqueueAudioDeletionJobsNow([storedAsset])).resolves.toBe(1);

    expect(mocks.audioDeletionJob.createMany).toHaveBeenCalledWith({
      data: [{ storedValue: storedAsset }],
      skipDuplicates: true,
    });
  });

  it('claims a due job, deletes the object, then removes the durable job', async () => {
    mocks.audioDeletionJob.findMany.mockResolvedValue([
      { id: 'job-a', storedValue: storedAsset, attempts: 0 },
    ]);

    const result = await processAudioDeletionJobs({ now });

    expect(result).toEqual({ candidates: 1, claimed: 1, deleted: 1, failed: 0 });
    expect(mocks.audioDeletionJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-a',
        nextAttemptAt: { lte: now },
        OR: [
          { lockedAt: null },
          { lockedAt: { lte: new Date('2026-07-19T07:55:00.000Z') } },
        ],
      },
      data: { lockedAt: now, attempts: { increment: 1 } },
    });
    expect(mocks.deleteTtsAsset).toHaveBeenCalledWith(storedAsset);
    expect(mocks.audioDeletionJob.deleteMany).toHaveBeenCalledWith({
      where: { id: 'job-a', lockedAt: now },
    });
  });

  it('keeps a failed job unlocked with exponential retry metadata', async () => {
    mocks.audioDeletionJob.findMany.mockResolvedValue([
      { id: 'job-a', storedValue: storedAsset, attempts: 2 },
    ]);
    mocks.deleteTtsAsset.mockRejectedValue(new Error('S3 temporarily unavailable'));

    const result = await processAudioDeletionJobs({ now });

    expect(result).toEqual({ candidates: 1, claimed: 1, deleted: 0, failed: 1 });
    expect(mocks.audioDeletionJob.deleteMany).not.toHaveBeenCalled();
    expect(mocks.audioDeletionJob.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'job-a', lockedAt: now },
      data: {
        lockedAt: null,
        lastError: 'Error: S3 temporarily unavailable',
        nextAttemptAt: new Date('2026-07-19T08:00:20.000Z'),
      },
    });
  });

  it('recovers a stale claim but skips a job won by another worker', async () => {
    mocks.audioDeletionJob.findMany.mockResolvedValue([
      { id: 'job-a', storedValue: storedAsset, attempts: 1 },
    ]);
    mocks.audioDeletionJob.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await processAudioDeletionJobs({ now, claimTimeoutMs: 60_000 });

    expect(result).toEqual({ candidates: 1, claimed: 0, deleted: 0, failed: 0 });
    expect(mocks.audioDeletionJob.findMany).toHaveBeenCalledWith({
      where: {
        nextAttemptAt: { lte: now },
        OR: [
          { lockedAt: null },
          { lockedAt: { lte: new Date('2026-07-19T07:59:00.000Z') } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 20,
      select: { id: true, storedValue: true, attempts: true },
    });
    expect(mocks.deleteTtsAsset).not.toHaveBeenCalled();
  });
});
