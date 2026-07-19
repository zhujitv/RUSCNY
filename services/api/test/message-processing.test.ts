import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  prisma: { translationMessage: { updateMany: mocks.updateMany } },
}));

import {
  PROCESSING_LEASE_MS,
  PROCESSING_TIMEOUT_CODE,
  PROCESSING_TIMEOUT_MESSAGE,
  recoverStaleProcessingMessages,
} from '../src/services/message-processing.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe('crashed message recovery', () => {
  it('atomically fails only PROCESSING rows at or beyond the lease boundary', async () => {
    const now = new Date('2026-07-18T12:00:00.000Z');
    const count = await recoverStaleProcessingMessages('conversation-a', now);

    expect(count).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation-a',
        status: 'PROCESSING',
        updatedAt: { lte: new Date(now.getTime() - PROCESSING_LEASE_MS) },
      },
      data: {
        status: 'FAILED',
        errorCode: PROCESSING_TIMEOUT_CODE,
        errorMessage: PROCESSING_TIMEOUT_MESSAGE,
        updatedAt: now,
      },
    });
  });
});
