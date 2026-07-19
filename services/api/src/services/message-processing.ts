import { config } from '../config.js';
import { prisma } from '../db.js';

// A processing attempt can pass through ASR, translation, TTS, and private
// audio persistence. Only rows beyond this full provider window are eligible
// for crash recovery.
export const PROCESSING_LEASE_MS = Math.max(
  120_000,
  config.ALIYUN_REQUEST_TIMEOUT_MS * 4,
);

export const PROCESSING_TIMEOUT_CODE = 'PROCESSING_TIMEOUT';
export const PROCESSING_TIMEOUT_MESSAGE = '消息处理超时，请重试';

/** Atomically closes sequence holes left by a crashed worker. */
export async function recoverStaleProcessingMessages(
  conversationId: string,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const recovered = await prisma.translationMessage.updateMany({
    where: {
      conversationId,
      status: 'PROCESSING',
      updatedAt: { lte: cutoff },
    },
    data: {
      status: 'FAILED',
      errorCode: PROCESSING_TIMEOUT_CODE,
      errorMessage: PROCESSING_TIMEOUT_MESSAGE,
      updatedAt: now,
    },
  });
  return recovered.count;
}
