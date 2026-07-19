import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  findAudioMessage: vi.fn(),
  authorizeConversation: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/auth.js', () => ({
  authenticate: vi.fn(async (request: {
    headers: { authorization?: string };
    auth?: unknown;
  }) => {
    if (request.headers.authorization !== 'Bearer audio-test-token') {
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    }
    request.auth = {
      subjectId: 'user-a',
      role: 'USER',
      deviceId: 'device-a',
      sessionId: 'session-a',
    };
  }),
}));

vi.mock('../src/db.js', () => ({
  prisma: {
    $transaction: routeMocks.transaction,
    translationMessage: { findFirst: routeMocks.findAudioMessage },
  },
}));

vi.mock('../src/services/conversations.js', () => ({
  getConversationForAuthInTransaction: routeMocks.authorizeConversation,
}));
import { config } from '../src/config.js';
import { registerAudioAssetRoutes } from '../src/routes/audio-assets.js';
import {
  deleteTtsAsset,
  persistTtsAudio,
  playableAudioUrl,
  readTtsAsset,
  verifyAssetSignature,
} from '../src/services/audio-assets.js';

let audioDirectory: string;
let app: FastifyInstance | undefined;
const originalDriver = config.AUDIO_STORAGE_DRIVER;
const originalDirectory = config.AUDIO_LOCAL_DIRECTORY;

beforeEach(async () => {
  audioDirectory = await mkdtemp(path.join(tmpdir(), 'translator-audio-test-'));
  config.AUDIO_STORAGE_DRIVER = 'local';
  config.AUDIO_LOCAL_DIRECTORY = audioDirectory;
  routeMocks.findAudioMessage.mockReset();
  routeMocks.authorizeConversation.mockReset();
  routeMocks.transaction.mockReset();
  routeMocks.transaction.mockImplementation(async (callback) => callback({
    translationMessage: { findFirst: routeMocks.findAudioMessage },
  }));
  routeMocks.findAudioMessage.mockResolvedValue({ conversationId: 'conversation-a' });
  routeMocks.authorizeConversation.mockResolvedValue({ id: 'conversation-a' });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = undefined;
  config.AUDIO_STORAGE_DRIVER = originalDriver;
  config.AUDIO_LOCAL_DIRECTORY = originalDirectory;
  await rm(audioDirectory, { recursive: true, force: true });
});

describe('private TTS playback URLs', () => {
  it('does not expose upstream or malformed stored URLs', () => {
    expect(playableAudioUrl(null)).toBeNull();
    expect(playableAudioUrl('http://temporary-upstream.example/audio.mp3')).toBeNull();
    expect(playableAudioUrl('asset:../../secret')).toBeNull();
  });

  it('creates a short-lived signature that verifies for exactly one asset', () => {
    const url = new URL(
      playableAudioUrl('asset:tts-123e4567-e89b-12d3-a456-426614174000.mp3')!,
    );
    const key = decodeURIComponent(url.pathname.split('/').at(-1)!);
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature')!;

    expect(() => verifyAssetSignature(key, expires, signature)).not.toThrow();
    expect(() =>
      verifyAssetSignature('tts-223e4567-e89b-12d3-a456-426614174000.mp3', expires, signature),
    ).toThrow('语音播放链接无效或已过期');
  });

  it('rejects expired playback URLs', () => {
    expect(() =>
      verifyAssetSignature(
        'tts-123e4567-e89b-12d3-a456-426614174000.mp3',
        Math.floor(Date.now() / 1_000) - 1,
        'invalid-signature-that-is-long-enough',
      ),
    ).toThrow('语音播放链接无效或已过期');
  });
});

describe('TTS asset persistence and delivery', () => {
  it('revalidates meeting access even when the signed URL is still valid', async () => {
    const bytes = Buffer.from('private-audio');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) },
    })));
    const stored = await persistTtsAudio(
      'https://tts-result.oss-cn-beijing.aliyuncs.com/private/audio.mp3',
    );
    const signed = new URL(playableAudioUrl(stored)!);
    routeMocks.authorizeConversation.mockRejectedValue(
      Object.assign(new Error('conversation not found'), { statusCode: 404 }),
    );
    app = Fastify({ logger: false });
    await registerAudioAssetRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: `${signed.pathname}${signed.search}`,
      headers: { authorization: 'Bearer audio-test-token' },
    });

    expect(response.statusCode).toBe(404);
    expect(routeMocks.authorizeConversation).toHaveBeenCalledTimes(1);
  });

  it('upgrades trusted Aliyun HTTP assets but rejects lookalike hosts', async () => {
    const bytes = Buffer.from('trusted-upgraded-audio');
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      persistTtsAudio('http://tts-result.oss-cn-beijing.aliyuncs.com/audio.mp3'),
    ).resolves.toMatch(/^asset:tts-[0-9a-f-]+\.mp3$/);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'https:',
        hostname: 'tts-result.oss-cn-beijing.aliyuncs.com',
      }),
      expect.any(Object),
    );
    fetchMock.mockClear();
    await expect(
      persistTtsAudio('https://aliyuncs.com.evil.example/audio.mp3'),
    ).rejects.toMatchObject({ code: 'TTS_ASSET_REJECTED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists trusted audio, serves it with private hardening headers, and deletes it', async () => {
    const bytes = Buffer.from('test-mp3-bytes');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length) },
    })));

    const stored = await persistTtsAudio(
      'https://tts-result.oss-cn-beijing.aliyuncs.com/generated/audio.mp3',
    );
    expect(stored).toMatch(/^asset:tts-[0-9a-f-]+\.mp3$/);
    const key = stored.slice('asset:'.length);
    await expect(readTtsAsset(key)).resolves.toMatchObject({ bytes, contentType: 'audio/mpeg' });

    app = Fastify({ logger: false });
    await registerAudioAssetRoutes(app);
    const signed = new URL(playableAudioUrl(stored)!);
    const unauthorized = await app.inject({
      method: 'GET',
      url: `${signed.pathname}${signed.search}`,
    });
    expect(unauthorized.statusCode).toBe(401);
    const response = await app.inject({
      method: 'GET',
      url: `${signed.pathname}${signed.search}`,
      headers: { authorization: 'Bearer audio-test-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-length']).toBe(String(bytes.length));
    expect(routeMocks.findAudioMessage).toHaveBeenCalledWith({
      where: { audioUrl: stored },
      select: { conversationId: true },
    });
    expect(routeMocks.authorizeConversation).toHaveBeenCalledWith(
      expect.objectContaining({ translationMessage: expect.any(Object) }),
      expect.objectContaining({ subjectId: 'user-a' }),
      'conversation-a',
      { history: true },
    );

    await deleteTtsAsset(stored);
    await expect(readTtsAsset(key)).rejects.toMatchObject({ code: 'AUDIO_NOT_FOUND' });
  });

  it('rejects a successful upstream response whose content type is not audio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));

    await expect(persistTtsAudio(
      'https://tts-result.oss-cn-beijing.aliyuncs.com/generated/audio.mp3',
    )).rejects.toMatchObject({ code: 'TTS_ASSET_INVALID' });
  });

  it('cancels an unbounded response stream as soon as it crosses the byte cap', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8_000_000));
        controller.enqueue(new Uint8Array(7_000_001));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    })));

    await expect(persistTtsAudio(
      'https://tts-result.oss-cn-beijing.aliyuncs.com/generated/audio.mp3',
    )).rejects.toMatchObject({ code: 'TTS_ASSET_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });
});
