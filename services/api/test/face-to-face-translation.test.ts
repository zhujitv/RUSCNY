import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AppError } from '../src/errors.js';

const mocks = vi.hoisted(() => ({
  authRole: 'USER' as 'USER' | 'GUEST',
  transcribe: vi.fn(),
  translate: vi.fn(),
  synthesize: vi.fn(),
}));

vi.mock('../src/auth.js', () => ({
  requireRole: (...roles: string[]) => async (request: FastifyRequest) => {
    if (!roles.includes(mocks.authRole)) {
      throw new AppError(403, 'FORBIDDEN', '无权执行此操作');
    }
    request.auth = {
      subjectId: 'user-a',
      role: mocks.authRole,
      deviceId: 'device-a',
      sessionId: 'session-a',
    };
  },
}));

vi.mock('../src/providers/translation.js', () => ({
  translationProvider: {
    transcribe: mocks.transcribe,
    translate: mocks.translate,
    synthesize: mocks.synthesize,
  },
  assertLanguagePair: (source: string, target: string) => {
    if (!['zh', 'ru'].includes(source) || !['zh', 'ru'].includes(target) || source === target) {
      throw new AppError(400, 'INVALID_LANGUAGE_PAIR', '第一版只支持中文与俄语互译');
    }
  },
}));

import { registerFaceToFaceRoutes } from '../src/routes/face-to-face.js';
import {
  clearFaceToFaceIdempotencyCacheForTests,
  translateFaceToFace,
} from '../src/services/face-to-face-translation.js';
import type { TranslationProvider } from '../src/providers/translation.js';

let app: FastifyInstance | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  clearFaceToFaceIdempotencyCacheForTests();
  mocks.authRole = 'USER';
  mocks.transcribe.mockResolvedValue({ text: '  你好  ', provider: 'asr' });
  mocks.translate.mockResolvedValue({ text: '  Здравствуйте  ', provider: 'mt' });
  mocks.synthesize.mockResolvedValue({
    audioUrl:
      'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/tts-a.mp3',
    provider: 'tts',
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('same-device face-to-face translation route', () => {
  it('runs transient Chinese to Russian ASR, MT and TTS for a formal user', async () => {
    app = await buildTestApp();
    const upload = multipartPayload({ audio: Buffer.from('voice-a') });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: {
        ...upload.headers,
        'idempotency-key': 'turn-0001',
      },
      payload: upload.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      ok: true,
      data: {
        idempotencyKey: 'turn-0001',
        sourceLanguage: 'zh',
        targetLanguage: 'ru',
        sourceText: '你好',
        translatedText: 'Здравствуйте',
        audioUrl:
          'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/tts-a.mp3',
        audioStatus: 'READY',
      },
    });
    expect(mocks.transcribe).toHaveBeenCalledWith({
      audio: Buffer.from('voice-a'),
      mimeType: 'audio/wav',
      language: 'zh',
    });
    expect(mocks.translate).toHaveBeenCalledWith({
      text: '你好',
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      terms: [],
    });
    expect(mocks.synthesize).toHaveBeenCalledWith({
      text: 'Здравствуйте',
      language: 'ru',
    });
  });

  it('keeps successful text when TTS is unavailable', async () => {
    mocks.synthesize.mockRejectedValue(
      new AppError(504, 'PROVIDER_TIMEOUT', '语音合成服务响应超时'),
    );
    app = await buildTestApp();
    const upload = multipartPayload({ audio: Buffer.from('voice-a') });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...upload.headers, 'idempotency-key': 'turn-0002' },
      payload: upload.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      sourceText: '你好',
      translatedText: 'Здравствуйте',
      audioUrl: null,
      audioStatus: 'UNAVAILABLE',
      errorCode: 'TTS_TIMEOUT',
    });
  });

  it('retries only TTS for the same turn after text already succeeded', async () => {
    mocks.synthesize
      .mockRejectedValueOnce(
        new AppError(504, 'PROVIDER_TIMEOUT', '语音合成服务响应超时'),
      )
      .mockResolvedValueOnce({
        audioUrl:
          'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/retry.mp3',
        provider: 'tts',
      });
    app = await buildTestApp();
    const upload = multipartPayload({ audio: Buffer.from('voice-retry') });
    const headers = { ...upload.headers, 'idempotency-key': 'turn-tts-retry' };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers,
      payload: upload.payload,
    });
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers,
      payload: upload.payload,
    });

    expect(first.json().data.audioStatus).toBe('UNAVAILABLE');
    expect(retry.json().data).toMatchObject({
      sourceText: '你好',
      translatedText: 'Здравствуйте',
      audioStatus: 'READY',
      audioUrl:
        'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/retry.mp3',
    });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    expect(mocks.synthesize).toHaveBeenCalledTimes(2);
  });

  it('upgrades trusted Aliyun speech to HTTPS and rejects other origins', async () => {
    const provider = providerStub();
    vi.mocked(provider.synthesize).mockResolvedValueOnce({
      audioUrl: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/turn.mp3',
      provider: 'tts',
    });

    await expect(
      translateFaceToFace(baseInput('trusted-0001'), { provider }),
    ).resolves.toMatchObject({
      audioUrl:
        'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/turn.mp3',
      audioStatus: 'READY',
    });

    vi.mocked(provider.synthesize).mockResolvedValueOnce({
      audioUrl: 'https://attacker-bucket.oss-cn-beijing.aliyuncs.com/turn.mp3',
      provider: 'tts',
    });
    await expect(
      translateFaceToFace(baseInput('untrusted-0001'), { provider }),
    ).resolves.toMatchObject({
      audioUrl: null,
      audioStatus: 'UNAVAILABLE',
      errorCode: 'TTS_ASSET_REJECTED',
    });
  });

  it('supports the reverse Russian to Chinese direction', async () => {
    mocks.transcribe.mockResolvedValue({ text: 'Где вокзал?', provider: 'asr' });
    mocks.translate.mockResolvedValue({ text: '火车站在哪里？', provider: 'mt' });
    app = await buildTestApp();
    const upload = multipartPayload({
      audio: Buffer.from('voice-ru'),
      sourceLanguage: 'ru',
      targetLanguage: 'zh',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...upload.headers, 'idempotency-key': 'turn-ru001' },
      payload: upload.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      sourceLanguage: 'ru',
      targetLanguage: 'zh',
      sourceText: 'Где вокзал?',
      translatedText: '火车站在哪里？',
      audioStatus: 'READY',
    });
    expect(mocks.synthesize).toHaveBeenCalledWith({
      text: '火车站在哪里？',
      language: 'zh',
    });
  });

  it('deduplicates a retry and rejects a changed recording with the same key', async () => {
    app = await buildTestApp();
    const first = multipartPayload({ audio: Buffer.from('voice-a') });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...first.headers, 'idempotency-key': 'turn-0003' },
      payload: first.payload,
    });
    const same = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...first.headers, 'idempotency-key': 'turn-0003' },
      payload: first.payload,
    });
    const changedUpload = multipartPayload({ audio: Buffer.from('voice-b') });
    const changed = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...changedUpload.headers, 'idempotency-key': 'turn-0003' },
      payload: changedUpload.payload,
    });

    expect(replay.statusCode).toBe(200);
    expect(same.statusCode).toBe(200);
    expect(same.json()).toEqual(replay.json());
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires a formal account, an idempotency key and valid audio metadata', async () => {
    app = await buildTestApp();
    const valid = multipartPayload({ audio: Buffer.from('voice-a') });
    const missingKey = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: valid.headers,
      payload: valid.payload,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const invalidMime = multipartPayload({
      audio: Buffer.from('voice-a'),
      filename: 'voice.exe',
      mimeType: 'application/octet-stream',
    });
    const invalidAudio = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...invalidMime.headers, 'idempotency-key': 'turn-0004' },
      payload: invalidMime.payload,
    });
    expect(invalidAudio.statusCode).toBe(400);
    expect(invalidAudio.json().code).toBe('INVALID_AUDIO');

    mocks.authRole = 'GUEST';
    const guestUpload = multipartPayload({ audio: Buffer.from('voice-a') });
    const guest = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...guestUpload.headers, 'idempotency-key': 'turn-0005' },
      payload: guestUpload.payload,
    });
    expect(guest.statusCode).toBe(403);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized audio before calling the provider', async () => {
    app = await buildTestApp();
    const emptyUpload = multipartPayload({ audio: Buffer.alloc(0) });
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...emptyUpload.headers, 'idempotency-key': 'turn-empty1' },
      payload: emptyUpload.payload,
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe('INVALID_AUDIO');

    const largeUpload = multipartPayload({ audio: Buffer.alloc(6_000_001, 1) });
    const large = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...largeUpload.headers, 'idempotency-key': 'turn-large1' },
      payload: largeUpload.payload,
    });
    expect(large.statusCode).toBe(413);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('rejects unsupported language directions before provider processing', async () => {
    app = await buildTestApp();
    const upload = multipartPayload({
      audio: Buffer.from('voice-a'),
      sourceLanguage: 'zh',
      targetLanguage: 'zh',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/face-to-face/translate',
      headers: { ...upload.headers, 'idempotency-key': 'turn-0006' },
      payload: upload.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_LANGUAGE_PAIR');
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});

describe('face-to-face provider failure boundary', () => {
  it('treats a blank ASR result as no speech and does not call translation', async () => {
    const provider = providerStub();
    vi.mocked(provider.transcribe).mockResolvedValue({ text: '   ', provider: 'asr' });

    await expect(
      translateFaceToFace(baseInput('blank-0001'), { provider }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'ASR_NO_SPEECH',
    });
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('turns an ASR stage timeout into a retryable request failure', async () => {
    const provider = providerStub({
      transcribe: () => new Promise(() => undefined),
    });
    await expect(
      translateFaceToFace(baseInput('timeout-0001'), {
        provider,
        stageTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      statusCode: 504,
      code: 'PROVIDER_TIMEOUT',
    });
  });

  it('allows the same idempotency key to retry after a provider failure', async () => {
    const provider = providerStub();
    vi.mocked(provider.transcribe)
      .mockRejectedValueOnce(new AppError(502, 'ASR_FAILED', '语音识别失败'))
      .mockResolvedValueOnce({ text: '你好', provider: 'asr' });
    const input = baseInput('retry-0001');

    await expect(translateFaceToFace(input, { provider })).rejects.toMatchObject({
      code: 'ASR_FAILED',
    });
    await expect(translateFaceToFace(input, { provider })).resolves.toMatchObject({
      translatedText: 'Здравствуйте',
    });
    expect(provider.transcribe).toHaveBeenCalledTimes(2);
  });
});

async function buildTestApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  await instance.register(multipart, {
    limits: { files: 1, fileSize: 6_000_000, fields: 10 },
  });
  await registerFaceToFaceRoutes(instance);
  instance.setErrorHandler(async (error: unknown, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        ok: false,
        code: error.code,
        message: error.message,
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: '请求参数不正确',
      });
    }
    const statusCode = error instanceof Error && 'statusCode' in error
      ? Number((error as Error & { statusCode?: number }).statusCode)
      : 500;
    return reply.code(statusCode).send({ ok: false, code: 'INTERNAL_ERROR' });
  });
  return instance;
}

function multipartPayload(input: {
  audio: Buffer;
  sourceLanguage?: string;
  targetLanguage?: string;
  filename?: string;
  mimeType?: string;
}): { headers: Record<string, string>; payload: Buffer } {
  const boundary = `test-boundary-${crypto.randomUUID()}`;
  const field = (name: string, value: string) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  const fileHead = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${input.filename ?? 'voice.wav'}"\r\nContent-Type: ${input.mimeType ?? 'audio/wav'}\r\n\r\n`,
  );
  const payload = Buffer.concat([
    field('sourceLanguage', input.sourceLanguage ?? 'zh'),
    field('targetLanguage', input.targetLanguage ?? 'ru'),
    fileHead,
    input.audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  };
}

function baseInput(idempotencyKey: string) {
  return {
    subjectId: 'user-a',
    deviceId: 'device-a',
    sessionId: 'session-a',
    idempotencyKey,
    sourceLanguage: 'zh' as const,
    targetLanguage: 'ru' as const,
    audio: Buffer.from('voice-a'),
    mimeType: 'audio/wav',
  };
}

function providerStub(overrides: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    transcribe: vi.fn().mockResolvedValue({ text: '你好', provider: 'asr' }),
    translate: vi.fn().mockResolvedValue({ text: 'Здравствуйте', provider: 'mt' }),
    synthesize: vi.fn().mockResolvedValue({
      audioUrl:
        'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/tts-a.mp3',
      provider: 'tts',
    }),
    ...overrides,
  };
}
