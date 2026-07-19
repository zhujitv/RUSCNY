import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => {
  const state = {
    ownerId: 'host-a',
    stale: false,
    contentUpdated: false,
    revokeBeforeSend: false,
    createConflictOnce: false,
    approved: true,
    distribution: null as null | Record<string, any>,
    recipients: [] as Array<Record<string, any>>,
  };
  const summary = {
    id: 'summary-a',
    conversationId: 'conversation-a',
    summary: '双方确认报价方案',
    participantRoster: [
      { participantId: 'participant-host', displayName: '王经理', company: 'CN Co', preferredLanguage: 'zh' },
      { participantId: 'participant-guest', displayName: 'Ivan', company: 'RU Co', preferredLanguage: 'ru' },
    ],
    coreDiscussion: [{
      participantId: 'participant-guest', speakerDisplayName: 'Ivan', speakerCompany: 'RU Co',
      sourceText: 'Подтверждаю', translatedText: '我确认',
    }],
    partyViews: [],
    confirmedItems: [{ text: '确认价格' }],
    actionItems: [],
    openQuestions: [],
    customerRequirements: [], products: [], specifications: [], quantity: [], price: [],
    delivery: [], paymentTerms: [], sourceMaxSequence: 1, sourceMessageCount: 1,
    sourceLatestMessageUpdatedAt: new Date('2026-07-18T23:59:00Z'),
    revision: 2, approvedRevision: 2, approvedAt: new Date('2026-07-19T00:00:10Z'),
    generatedAt: new Date('2026-07-19T00:00:00Z'),
  };
  const participants = [
    {
      id: 'participant-host', conversationId: 'conversation-a', role: 'HOST', userId: 'host-a',
      guestIdentityId: null, displayName: '王经理', company: 'CN Co', email: 'host@example.test',
      preferredLanguage: 'zh', presence: 'LEFT', joinedAt: new Date(), leftAt: new Date(),
      lastSeenAt: new Date(), removedAt: null,
      user: { email: 'host@example.test', status: 'ACTIVE' }, guestIdentity: null,
    },
    {
      id: 'participant-guest', conversationId: 'conversation-a', role: 'GUEST', userId: null,
      guestIdentityId: 'guest-a', displayName: 'Ivan', company: 'RU Co', email: 'ivan@example.test',
      preferredLanguage: 'ru', presence: 'LEFT', joinedAt: new Date(), leftAt: new Date(),
      lastSeenAt: new Date(), removedAt: null, user: null,
      guestIdentity: { email: 'ivan@example.test', revokedAt: null, expiresAt: new Date('2099-01-01') },
    },
    {
      id: 'participant-old', conversationId: 'conversation-a', role: 'GUEST', userId: null,
      guestIdentityId: 'guest-old', displayName: 'Legacy Guest', company: 'RU Co', email: null,
      preferredLanguage: 'ru', presence: 'LEFT', joinedAt: new Date(), leftAt: new Date(),
      lastSeenAt: new Date(), removedAt: null, user: null,
      guestIdentity: { email: null, revokedAt: null, expiresAt: new Date('2099-01-01') },
    },
  ];
  const transaction = {
    conversationSummary: {
      findUnique: vi.fn(async () => state.approved
        ? summary
        : { ...summary, approvedRevision: null, approvedAt: null }),
    },
    participant: { findMany: vi.fn(async () => participants) },
    translationMessage: { aggregate: vi.fn(async () => ({
      _max: {
        sequence: state.stale ? 2 : 1,
        updatedAt: state.contentUpdated
          ? new Date('2026-07-19T00:01:00Z')
          : summary.sourceLatestMessageUpdatedAt,
      },
      _count: { _all: state.stale ? 2 : 1 },
    })) },
    summaryEmailDistribution: {
      findUnique: vi.fn(async ({ where }: any) =>
        state.distribution?.conversationId ===
            where.conversationId_idempotencyKey?.conversationId &&
        state.distribution?.idempotencyKey ===
            where.conversationId_idempotencyKey?.idempotencyKey
          ? state.distribution
          : null),
      findFirst: vi.fn(async ({ where }: any) =>
        state.distribution?.id === where.id &&
        state.distribution?.conversationId === where.conversationId
          ? { ...state.distribution, recipients: state.recipients }
          : null),
      create: vi.fn(async ({ data }: any) => {
        state.recipients = data.recipients.create.map((recipient: any, index: number) => ({
          id: `recipient-${index + 1}`, distributionId: 'distribution-a', ...recipient,
          status: 'PENDING', attempts: 0, claimedAt: null, providerMessageId: null,
          errorCode: null, errorMessage: null, sentAt: null, createdAt: new Date(), updatedAt: new Date(),
        }));
        state.distribution = {
          id: 'distribution-a', ...data, status: 'PROCESSING', sentCount: 0, failedCount: 0,
          completedAt: null, createdAt: new Date(),
        };
        if (state.createConflictOnce) {
          state.createConflictOnce = false;
          throw { code: 'P2002' };
        }
        return { id: 'distribution-a' };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    conversationSummary: {
      findUnique: vi.fn(async () => state.approved
        ? summary
        : { ...summary, approvedRevision: null, approvedAt: null }),
    },
    translationMessage: {
      aggregate: vi.fn(async () => ({
        _max: {
          sequence: state.stale ? 2 : 1,
          updatedAt: state.contentUpdated
            ? new Date('2026-07-19T00:01:00Z')
            : summary.sourceLatestMessageUpdatedAt,
        },
        _count: { _all: state.stale ? 2 : 1 },
      })),
    },
    participant: {
      findFirst: vi.fn(async ({ where }: any) => {
        const participant = participants.find((item) =>
          item.id === where.id && item.conversationId === where.conversationId,
        );
        if (!participant) return null;
        return state.revokeBeforeSend
          ? { ...participant, removedAt: new Date() }
          : participant;
      }),
    },
    summaryEmailDistribution: {
      findUnique: vi.fn(async () => state.distribution),
      findMany: vi.fn(async () =>
        state.distribution?.status === 'PROCESSING'
          ? [{ id: state.distribution.id }]
          : []),
      findUniqueOrThrow: vi.fn(async () => ({
        ...state.distribution,
        conversation: { title: '报价会议' },
        recipients: state.recipients,
      })),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(state.distribution!, data);
        return state.distribution;
      }),
    },
    summaryEmailRecipient: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const recipient of state.recipients) {
          if (where.id && recipient.id !== where.id) continue;
          if (where.distributionId && recipient.distributionId !== where.distributionId) continue;
          if (typeof where.status === 'string' && recipient.status !== where.status) continue;
          if (where.status?.in && !where.status.in.includes(recipient.status)) continue;
          recipient.status = data.status ?? recipient.status;
          recipient.claimedAt = data.claimedAt === null ? null : (data.claimedAt ?? recipient.claimedAt);
          recipient.attempts += data.attempts?.increment ?? 0;
          for (const key of ['providerMessageId', 'sentAt', 'errorCode', 'errorMessage']) {
            if (key in data) recipient[key] = data[key];
          }
          count += 1;
        }
        return { count };
      }),
      findMany: vi.fn(async ({ where, select }: any) => {
        const rows = state.recipients.filter((recipient) => {
          if (where.distributionId && recipient.distributionId !== where.distributionId) return false;
          if (typeof where.status === 'string' && recipient.status !== where.status) return false;
          return true;
        });
        return select ? rows.map((recipient) => ({ status: recipient.status })) : rows;
      }),
    },
  };
  return {
    state, summary, participants, transaction, prisma,
    getConversation: vi.fn(async () => ({
      id: 'conversation-a', ownerId: state.ownerId, title: '报价会议', status: 'ENDED',
    })),
    sendEmail: vi.fn(async () => ({ providerMessageId: 'email-provider-id' })),
  };
});

vi.mock('../src/db.js', () => ({ prisma: mocks.prisma }));
vi.mock('../src/auth.js', () => ({
  requireRole: () => async (request: { auth?: unknown }) => {
    request.auth = { subjectId: 'host-a', role: 'USER', deviceId: 'device-a', sessionId: 'session-a' };
  },
}));
vi.mock('../src/services/conversations.js', () => ({
  getConversationForAuthInTransaction: mocks.getConversation,
}));
vi.mock('../src/services/email-provider.js', () => ({
  EmailProviderError: class EmailProviderError extends Error {},
  sendTransactionalEmail: mocks.sendEmail,
}));

import { AppError } from '../src/errors.js';
import {
  processPendingSummaryEmailDistributions,
  processSummaryEmailDistribution,
  registerSummaryEmailRoutes,
} from '../src/routes/summary-email.js';

let app: FastifyInstance | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.state.ownerId = 'host-a';
  mocks.state.stale = false;
  mocks.state.contentUpdated = false;
  mocks.state.revokeBeforeSend = false;
  mocks.state.createConflictOnce = false;
  mocks.state.approved = true;
  mocks.state.distribution = null;
  mocks.state.recipients = [];
  app = Fastify({ logger: false });
  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof AppError) {
      await reply.code(error.statusCode).send({ ok: false, code: error.code, message: error.message });
      return;
    }
    if (error instanceof ZodError) {
      await reply.code(400).send({ ok: false, code: 'VALIDATION_ERROR' });
      return;
    }
    throw error;
  });
  await registerSummaryEmailRoutes(app);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('meeting summary email distribution', () => {
  it('lists only masked server-owned recipient hints and marks legacy guests without email', async () => {
    const response = await app!.inject({
      method: 'GET', url: '/v1/conversations/conversation-a/summary/email-recipients',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ participantId: 'participant-guest', emailHint: 'i***n@example.test', eligible: true }),
      expect.objectContaining({ participantId: 'participant-old', emailHint: null, eligible: false, reason: 'PARTICIPANT_EMAIL_MISSING' }),
    ]));
    expect(response.body).not.toContain('ivan@example.test');
  });

  it('sends one private email per selected participant and records completion', async () => {
    const started = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-a' },
      payload: { participantIds: ['participant-host', 'participant-guest'] },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().data.distribution.status).toBe('PROCESSING');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    await processSummaryEmailDistribution('distribution-a');
    const response = await app!.inject({
      method: 'GET',
      url: '/v1/conversations/conversation-a/summary/email-distributions/distribution-a',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail.mock.calls.map(([email]) => email.to).sort()).toEqual([
      'host@example.test', 'ivan@example.test',
    ]);
    expect(response.json().data.distribution).toMatchObject({
      status: 'COMPLETED', recipientCount: 2, sentCount: 2, failedCount: 0,
    });
    expect(response.body).not.toContain('ivan@example.test');
  });

  it('lets the durable worker discover a queued distribution after request completion', async () => {
    const started = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-worker-scan' },
      payload: { participantIds: ['participant-guest'] },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();

    await expect(processPendingSummaryEmailDistributions()).resolves.toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(mocks.state.distribution?.status).toBe('COMPLETED');
  });

  it('rejects a stale summary before sending any email', async () => {
    mocks.state.stale = true;
    const response = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-stale' },
      payload: { participantIds: ['participant-host'] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SUMMARY_STALE');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects an AI draft until the host approves its current revision', async () => {
    mocks.state.approved = false;
    const response = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-unapproved' },
      payload: { participantIds: ['participant-host'] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SUMMARY_APPROVAL_REQUIRED');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a summary after an in-place message correction', async () => {
    mocks.state.contentUpdated = true;
    const response = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-corrected' },
      payload: { participantIds: ['participant-host'] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SUMMARY_STALE');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('stops a queued distribution when a correction lands before the worker', async () => {
    const started = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-correction-race' },
      payload: { participantIds: ['participant-guest'] },
    });
    expect(started.statusCode, started.body).toBe(200);

    mocks.state.contentUpdated = true;
    await processSummaryEmailDistribution('distribution-a');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.state.distribution).toMatchObject({
      status: 'FAILED', sentCount: 0, failedCount: 1,
    });
    expect(mocks.state.recipients[0]).toMatchObject({
      status: 'FAILED', errorCode: 'SUMMARY_STALE',
    });
  });

  it('does not replay an ambiguous provider claim after the safe idempotency window', async () => {
    const started = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-expired-claim' },
      payload: { participantIds: ['participant-guest'] },
    });
    expect(started.statusCode, started.body).toBe(200);
    mocks.state.recipients[0]!.status = 'SENDING';
    mocks.state.recipients[0]!.claimedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);

    await processSummaryEmailDistribution('distribution-a');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.state.recipients[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'EMAIL_DELIVERY_UNKNOWN_RETRY_EXPIRED',
    });
  });

  it('rechecks server-owned access immediately before sending', async () => {
    mocks.state.revokeBeforeSend = true;
    const started = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-revoked' },
      payload: { participantIds: ['participant-guest'] },
    });
    expect(started.statusCode, started.body).toBe(200);
    await processSummaryEmailDistribution('distribution-a');
    const response = await app!.inject({
      method: 'GET',
      url: '/v1/conversations/conversation-a/summary/email-distributions/distribution-a',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(response.json().data.distribution).toMatchObject({
      status: 'FAILED', sentCount: 0, failedCount: 1,
    });
    expect(response.json().data.distribution.recipients[0]).toMatchObject({
      status: 'FAILED', errorCode: 'PARTICIPANT_REMOVED',
    });
  });

  it('converges on the winning distribution after a concurrent unique-key race', async () => {
    mocks.state.createConflictOnce = true;
    const started = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-race' },
      payload: { participantIds: ['participant-guest'] },
    });

    expect(started.statusCode, started.body).toBe(200);
    expect(mocks.prisma.summaryEmailDistribution.findUnique).toHaveBeenCalledOnce();
    await processSummaryEmailDistribution('distribution-a');
    const response = await app!.inject({
      method: 'GET',
      url: '/v1/conversations/conversation-a/summary/email-distributions/distribution-a',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(response.json().data.distribution).toMatchObject({
      id: 'distribution-a', status: 'COMPLETED', sentCount: 1,
    });
  });

  it('rejects reuse of an idempotency key for a different recipient set', async () => {
    const first = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-reused' },
      payload: { participantIds: ['participant-guest'] },
    });
    expect(first.statusCode, first.body).toBe(200);

    const reused = await app!.inject({
      method: 'POST',
      url: '/v1/conversations/conversation-a/summary/email-distributions',
      headers: { 'idempotency-key': 'distribution-request-reused' },
      payload: { participantIds: ['participant-host'] },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('does not expose a distribution under another conversation path', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/v1/conversations/conversation-other/summary/email-distributions/distribution-a',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('SUMMARY_EMAIL_DISTRIBUTION_NOT_FOUND');
  });

  it('rejects a host account that does not own the meeting', async () => {
    mocks.state.ownerId = 'another-host';
    const response = await app!.inject({
      method: 'GET', url: '/v1/conversations/conversation-a/summary/email-recipients',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('HOST_ONLY');
  });
});
