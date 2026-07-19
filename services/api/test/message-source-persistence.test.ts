import type { TranslationMessage } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/errors.js';

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    translationMessage: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)),
    },
  };
});

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));

import {
  failMessageAttempt,
  persistRecognizedSourceText,
} from '../src/routes/messages.js';

const processing = {
  id: 'message-a',
  participantId: 'participant-a',
  status: 'PROCESSING',
  sourceText: '',
  updatedAt: new Date('2026-07-18T12:00:00.000Z'),
} as TranslationMessage;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.$queryRaw
    .mockReset()
    .mockResolvedValueOnce([{
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
    }])
    .mockResolvedValueOnce([{ id: 'user-a', status: 'ACTIVE' }])
    .mockResolvedValueOnce([{ sessionId: 'session-a', revokedAt: null }])
    .mockResolvedValueOnce([{
      removedAt: null,
      leftAt: null,
      presence: 'ONLINE',
      userId: 'user-a',
      guestIdentityId: null,
    }]);
  mocks.transaction.translationMessage.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.translationMessage.findUnique.mockResolvedValue({
    ...processing,
    sourceText: '识别后的原文',
    updatedAt: new Date('2026-07-18T12:00:01.000Z'),
  });
});

describe('recognized source persistence', () => {
  it('saves ASR text with a processing-generation CAS before translation', async () => {
    const result = await persistRecognizedSourceText(
      processing,
      '识别后的原文',
      {
        subjectId: 'user-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
    );

    expect(result.committed).toBe(true);
    expect(result.message.sourceText).toBe('识别后的原文');
    expect(mocks.transaction.translationMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'message-a',
        status: 'PROCESSING',
        updatedAt: processing.updatedAt,
      },
      data: {
        sourceText: '识别后的原文',
        updatedAt: expect.any(Date),
      },
    });
  });

  it('reports a lost lease without overwriting the terminal row', async () => {
    mocks.transaction.translationMessage.updateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.translationMessage.findUnique.mockResolvedValue({
      ...processing,
      status: 'FAILED',
      sourceText: '',
      errorCode: 'PARTICIPANT_REMOVED',
    });

    const result = await persistRecognizedSourceText(
      processing,
      '过期识别结果',
      {
        subjectId: 'user-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
    );

    expect(result.committed).toBe(false);
    expect(result.message.status).toBe('FAILED');
  });

  it('does not save an ASR result after the device session was revoked', async () => {
    const now = new Date();
    mocks.transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{
        status: 'ACTIVE',
        expiresAt: new Date(now.getTime() + 60_000),
      }])
      .mockResolvedValueOnce([{ id: 'user-a', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ sessionId: 'session-a', revokedAt: now }]);

    await expect(persistRecognizedSourceText(
      processing,
      '不应保存的原文',
      {
        subjectId: 'user-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
    )).rejects.toMatchObject({ code: 'DEVICE_REVOKED', statusCode: 401 });
    expect(mocks.transaction.translationMessage.updateMany).not.toHaveBeenCalled();
  });
});

describe('failed attempt authorization boundary', () => {
  it('keeps a recognized source when translation fails for an authorized sender', async () => {
    mocks.transaction.translationMessage.findUnique.mockResolvedValue({
      ...processing,
      status: 'FAILED',
      sourceText: '已识别原文',
      errorCode: 'MT_FAILED',
      errorMessage: '翻译失败',
    });

    const result = await failMessageAttempt(
      processing,
      new AppError(502, 'MT_FAILED', '翻译失败'),
      {
        subjectId: 'user-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
      '已识别原文',
    );

    expect(result.authorizationValid).toBe(true);
    expect(mocks.transaction.translationMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'message-a',
        status: 'PROCESSING',
        updatedAt: processing.updatedAt,
      },
      data: {
        status: 'FAILED',
        errorCode: 'MT_FAILED',
        errorMessage: '翻译失败',
        sourceText: '已识别原文',
        updatedAt: expect.any(Date),
      },
    });
  });

  it('persists a revoke failure without broadcasting eligibility when revoke wins', async () => {
    const now = new Date();
    mocks.transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{
        status: 'ACTIVE',
        expiresAt: new Date(now.getTime() + 60_000),
      }])
      .mockResolvedValueOnce([{ id: 'user-a', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ sessionId: 'session-a', revokedAt: now }]);
    mocks.transaction.translationMessage.findUnique.mockResolvedValue({
      ...processing,
      status: 'FAILED',
      errorCode: 'DEVICE_REVOKED',
      errorMessage: '此设备登录已被撤销',
    });

    const result = await failMessageAttempt(
      processing,
      new AppError(502, 'MT_FAILED', '翻译失败'),
      {
        subjectId: 'user-a',
        role: 'USER',
        deviceId: 'device-a',
        sessionId: 'session-a',
      },
      'conversation-a',
    );

    expect(result.committed).toBe(true);
    expect(result.authorizationValid).toBe(false);
    expect(result.error.code).toBe('DEVICE_REVOKED');
    expect(mocks.transaction.translationMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'message-a',
        status: 'PROCESSING',
        updatedAt: processing.updatedAt,
      },
      data: {
        status: 'FAILED',
        errorCode: 'DEVICE_REVOKED',
        errorMessage: '此设备登录已被撤销',
        updatedAt: expect.any(Date),
      },
    });
  });
});
