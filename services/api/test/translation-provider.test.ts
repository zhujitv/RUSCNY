import { describe, expect, it } from 'vitest';
import {
  assertLanguagePair,
  providerHttpError,
  translationProvider,
} from '../src/providers/translation.js';

describe('mock translation pipeline', () => {
  it('uses a supplied recognition hint without retaining audio', async () => {
    await expect(
      translationProvider.transcribe({
        audio: Buffer.from('test-audio'),
        mimeType: 'audio/aac',
        language: 'ru',
        mockHint: '  Какой минимальный объём заказа?  ',
      }),
    ).resolves.toMatchObject({
      text: 'Какой минимальный объём заказа?',
      provider: 'mock',
    });
  });

  it('translates both a known business phrase and an unknown phrase', async () => {
    await expect(
      translationProvider.translate({
        text: '这个产品有库存。',
        sourceLanguage: 'zh',
        targetLanguage: 'ru',
        terms: [],
      }),
    ).resolves.toMatchObject({ text: 'Этот товар есть в наличии.' });

    await expect(
      translationProvider.translate({
        text: '测试新产品',
        sourceLanguage: 'zh',
        targetLanguage: 'ru',
        terms: [],
      }),
    ).resolves.toMatchObject({ text: '[模拟俄语译文] 测试新产品' });
  });

  it('exercises the expected text-only degradation when TTS fails', async () => {
    await expect(
      translationProvider.synthesize({ text: 'Здравствуйте', language: 'ru' }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'TTS_UNAVAILABLE',
    });
  });
});

describe('provider error boundary', () => {
  it('uses stable public messages instead of upstream response text', () => {
    expect(providerHttpError(429)).toMatchObject({
      statusCode: 429,
      code: 'PROVIDER_RATE_LIMITED',
      message: '翻译服务请求过于频繁，请稍后重试',
    });
    expect(providerHttpError(500)).toMatchObject({
      statusCode: 502,
      code: 'PROVIDER_FAILED',
      message: '翻译服务调用失败',
    });
  });
});

describe('v1 language boundary', () => {
  it('accepts only opposite Chinese and Russian directions', () => {
    expect(() => assertLanguagePair('zh', 'ru')).not.toThrow();
    expect(() => assertLanguagePair('ru', 'zh')).not.toThrow();
    expect(() => assertLanguagePair('zh', 'zh')).toThrow('第一版只支持中文与俄语互译');
    expect(() => assertLanguagePair('en', 'ru')).toThrow('第一版只支持中文与俄语互译');
  });
});
