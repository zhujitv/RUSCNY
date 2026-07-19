import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { prisma } from '../db.js';
import { notFound } from '../errors.js';
import {
  readTtsAsset,
  storedAudioAssetValue,
  verifyAssetSignature,
} from '../services/audio-assets.js';
import { getConversationForAuthInTransaction } from '../services/conversations.js';

export async function registerAudioAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/audio/assets/:key', { preHandler: authenticate }, async (request, reply) => {
    const { key } = z.object({ key: z.string() }).parse(request.params);
    const { expires, signature } = z
      .object({
        expires: z.coerce.number().int().positive(),
        signature: z.string().min(32).max(200),
      })
      .parse(request.query);
    verifyAssetSignature(key, expires, signature);
    // Load the opaque object before opening the database transaction. The
    // bytes are never sent until the final membership/session check below, and
    // this avoids holding permission row locks across local/S3 I/O.
    const asset = await readTtsAsset(key);
    await prisma.$transaction(async (tx) => {
      const message = await tx.translationMessage.findFirst({
        where: { audioUrl: storedAudioAssetValue(key) },
        select: { conversationId: true },
      });
      if (!message) throw notFound('AUDIO_NOT_FOUND', '语音不存在或已清理');
      await getConversationForAuthInTransaction(
        tx,
        request.auth,
        message.conversationId,
        { history: true },
      );
    });
    return reply
      .type(asset.contentType)
      .header('Cache-Control', 'private, no-store')
      .header('Pragma', 'no-cache')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Length', String(asset.bytes.length))
      .header('Content-Disposition', 'inline')
      .send(asset.bytes);
  });
}
