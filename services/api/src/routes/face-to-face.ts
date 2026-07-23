import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { badRequest } from '../errors.js';
import {
  normalizeMimeType,
  readAudioUpload,
  validateMimeType,
} from '../lib/audio-upload.js';
import { assertLanguagePair } from '../providers/translation.js';
import { translateFaceToFace } from '../services/face-to-face-translation.js';

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export async function registerFaceToFaceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/face-to-face/translate',
    {
      preHandler: requireRole('USER'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const idempotencyKey = parseIdempotencyKey(request);
      const upload = await readAudioUpload(request);
      validateMimeType(upload.mimeType, upload.filename);
      const pair = z
        .object({
          sourceLanguage: z.enum(['zh', 'ru']),
          targetLanguage: z.enum(['zh', 'ru']),
        })
        .parse({
          sourceLanguage: upload.fields.sourceLanguage,
          targetLanguage: upload.fields.targetLanguage,
        });
      assertLanguagePair(pair.sourceLanguage, pair.targetLanguage);
      if (!request.auth.sessionId) {
        throw badRequest('SESSION_REQUIRED', '登录会话无效');
      }

      const data = await translateFaceToFace({
        subjectId: request.auth.subjectId,
        deviceId: request.auth.deviceId,
        sessionId: request.auth.sessionId,
        idempotencyKey,
        sourceLanguage: pair.sourceLanguage,
        targetLanguage: pair.targetLanguage,
        audio: upload.audio,
        mimeType: normalizeMimeType(upload.mimeType, upload.filename),
      });

      return reply.header('Cache-Control', 'no-store').send({ ok: true, data });
    },
  );
}

function parseIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  const header = Array.isArray(value) ? value[0] : value?.toString();
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw badRequest('IDEMPOTENCY_KEY_REQUIRED', '缺少有效的 Idempotency-Key');
  }
  return parsed.data;
}
