import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { AppError, conflict } from '../errors.js';
import {
  translationProvider,
  type TranslationProvider,
} from '../providers/translation.js';
import { trustedTransientTtsAudioUrl } from './audio-assets.js';

type SpeechLanguage = 'zh' | 'ru';

export interface FaceToFaceTranslationInput {
  subjectId: string;
  deviceId: string;
  sessionId: string;
  idempotencyKey: string;
  sourceLanguage: SpeechLanguage;
  targetLanguage: SpeechLanguage;
  audio: Buffer;
  mimeType: string;
}

export interface FaceToFaceTranslationResult {
  idempotencyKey: string;
  sourceLanguage: SpeechLanguage;
  targetLanguage: SpeechLanguage;
  sourceText: string;
  translatedText: string;
  audioUrl: string | null;
  audioStatus: 'READY' | 'UNAVAILABLE';
  errorCode?: string;
}

interface IdempotencyEntry {
  requestHash: string;
  expiresAt: number;
  result: Promise<FaceToFaceTranslationResult>;
}

const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const IDEMPOTENCY_MAX_ENTRIES = 500;
const idempotencyEntries = new Map<string, IdempotencyEntry>();

/**
 * Runs a transient ASR -> MT -> TTS turn. Audio and translated content are
 * never written to Prisma or storage. A small process-local response cache is
 * retained briefly only so an HTTP retry with the same key cannot replay the
 * paid provider calls on this API instance.
 */
export async function translateFaceToFace(
  input: FaceToFaceTranslationInput,
  options: {
    provider?: TranslationProvider;
    stageTimeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<FaceToFaceTranslationResult> {
  const now = options.now ?? Date.now;
  purgeExpiredIdempotencyEntries(now());

  const scope = JSON.stringify([
    input.subjectId,
    input.deviceId,
    input.sessionId,
    input.idempotencyKey,
  ]);
  const requestHash = faceToFaceRequestHash(input);
  const provider = options.provider ?? translationProvider;
  const stageTimeoutMs =
    options.stageTimeoutMs ?? config.ALIYUN_REQUEST_TIMEOUT_MS;
  const existing = idempotencyEntries.get(scope);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw conflict(
        'IDEMPOTENCY_KEY_REUSED',
        '同一 Idempotency-Key 不能用于不同的录音',
      );
    }
    return retryUnavailableSpeech(
      existing,
      provider,
      stageTimeoutMs,
    );
  }

  if (idempotencyEntries.size >= IDEMPOTENCY_MAX_ENTRIES) {
    throw new AppError(503, 'IDEMPOTENCY_CAPACITY_EXCEEDED', '临时翻译请求较多，请稍后重试');
  }
  const result = runPipeline(input, provider, stageTimeoutMs);
  idempotencyEntries.set(scope, {
    requestHash,
    expiresAt: now() + IDEMPOTENCY_TTL_MS,
    result,
  });

  try {
    return await result;
  } catch (error) {
    // Provider failures are retryable. Removing the entry lets the client use
    // the same logical turn key for a deliberate retry after an error.
    if (idempotencyEntries.get(scope)?.result === result) {
      idempotencyEntries.delete(scope);
    }
    throw error;
  }
}

async function retryUnavailableSpeech(
  entry: IdempotencyEntry,
  provider: TranslationProvider,
  stageTimeoutMs: number,
): Promise<FaceToFaceTranslationResult> {
  const current = entry.result;
  const previous = await current;
  if (previous.audioStatus === 'READY') return previous;
  // Concurrent retries share the first retry promise instead of multiplying
  // synthesis calls.
  if (entry.result !== current) return entry.result;
  const retried = synthesizeTranslationAudio(previous, provider, stageTimeoutMs);
  entry.result = retried;
  return retried;
}

async function runPipeline(
  input: FaceToFaceTranslationInput,
  provider: TranslationProvider,
  stageTimeoutMs: number,
): Promise<FaceToFaceTranslationResult> {
  let transcription: Awaited<ReturnType<TranslationProvider['transcribe']>>;
  try {
    transcription = await withStageTimeout(
      provider.transcribe({
        audio: input.audio,
        mimeType: input.mimeType,
        language: input.sourceLanguage,
      }),
      stageTimeoutMs,
      '语音识别',
    );
  } catch (error) {
    throw stageError(error, 'ASR_FAILED', '语音识别失败');
  }
  const sourceText = normalizedProviderText(
    transcription.text,
    'ASR_NO_SPEECH',
    '未识别到有效语音',
  );

  let translation: Awaited<ReturnType<TranslationProvider['translate']>>;
  try {
    translation = await withStageTimeout(
      provider.translate({
        text: sourceText,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        terms: [],
      }),
      stageTimeoutMs,
      '文字翻译',
    );
  } catch (error) {
    throw stageError(error, 'MT_FAILED', '文字翻译失败');
  }
  const translatedText = normalizedProviderText(
    translation.text,
    'MT_FAILED',
    '翻译服务未返回译文',
  );

  return synthesizeTranslationAudio(
    {
      idempotencyKey: input.idempotencyKey,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceText,
      translatedText,
      audioUrl: null,
      audioStatus: 'UNAVAILABLE',
    },
    provider,
    stageTimeoutMs,
  );
}

async function synthesizeTranslationAudio(
  textResult: FaceToFaceTranslationResult,
  provider: TranslationProvider,
  stageTimeoutMs: number,
): Promise<FaceToFaceTranslationResult> {
  try {
    const speech = await withStageTimeout(
      provider.synthesize({
        text: textResult.translatedText,
        language: textResult.targetLanguage,
      }),
      stageTimeoutMs,
      '语音合成',
    );
    const audioUrl = trustedTransientTtsAudioUrl(speech.audioUrl).toString();
    return {
      idempotencyKey: textResult.idempotencyKey,
      sourceLanguage: textResult.sourceLanguage,
      targetLanguage: textResult.targetLanguage,
      sourceText: textResult.sourceText,
      translatedText: textResult.translatedText,
      audioUrl,
      audioStatus: 'READY',
    };
  } catch (error) {
    return {
      idempotencyKey: textResult.idempotencyKey,
      sourceLanguage: textResult.sourceLanguage,
      targetLanguage: textResult.targetLanguage,
      sourceText: textResult.sourceText,
      translatedText: textResult.translatedText,
      audioUrl: null,
      audioStatus: 'UNAVAILABLE',
      errorCode: ttsErrorCode(error),
    };
  }
}

function normalizedProviderText(
  value: string,
  code: string,
  message: string,
): string {
  const text = value.trim();
  if (!text) throw new AppError(422, code, message);
  if (text.length > 10_000) {
    throw new AppError(502, code, '翻译服务返回内容过长');
  }
  return text;
}

function stageError(error: unknown, code: string, message: string): AppError {
  return error instanceof AppError ? error : new AppError(502, code, message);
}

function ttsErrorCode(error: unknown): string {
  if (!(error instanceof AppError)) return 'TTS_FAILED';
  if (error.code === 'PROVIDER_TIMEOUT') return 'TTS_TIMEOUT';
  if (error.code === 'PROVIDER_RATE_LIMITED') return 'TTS_RATE_LIMITED';
  return error.code.startsWith('TTS_') ? error.code : 'TTS_FAILED';
}

async function withStageTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  stageName: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AppError(504, 'PROVIDER_TIMEOUT', `${stageName}服务响应超时`));
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function faceToFaceRequestHash(input: FaceToFaceTranslationInput): string {
  return createHash('sha256')
    .update(input.sourceLanguage)
    .update('\0')
    .update(input.targetLanguage)
    .update('\0')
    .update(input.mimeType)
    .update('\0')
    .update(input.audio)
    .digest('hex');
}

function purgeExpiredIdempotencyEntries(now: number): void {
  for (const [key, entry] of idempotencyEntries) {
    if (entry.expiresAt <= now) idempotencyEntries.delete(key);
  }
}

export function clearFaceToFaceIdempotencyCacheForTests(): void {
  idempotencyEntries.clear();
}
