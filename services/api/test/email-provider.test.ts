import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 're_server_secret',
    RESEND_API_BASE_URL: 'https://api.resend.test',
    EMAIL_FROM: 'RUSCNY <minutes@send.ruscny.net>',
    EMAIL_REPLY_TO: undefined,
    EMAIL_REQUEST_TIMEOUT_MS: 15_000,
  },
}));

vi.mock('../src/config.js', () => ({ config: mocks.config }));

import {
  EmailProviderError,
  sendTransactionalEmail,
} from '../src/services/email-provider.js';

const email = {
  to: 'recipient@example.test',
  subject: '会议纪要',
  text: '正文',
  html: '<p>正文</p>',
  idempotencyKey: 'summary/distribution/recipient/r1',
};

beforeEach(() => vi.clearAllMocks());

describe('Resend transactional email adapter', () => {
  it('sends exactly one recipient with a server-side idempotency key', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ id: 'provider-message-a' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(sendTransactionalEmail(email, fetcher as typeof fetch)).resolves.toEqual({
      providerMessageId: 'provider-message-a',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.resend.test/emails');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer re_server_secret',
      'Idempotency-Key': email.idempotencyKey,
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: mocks.config.EMAIL_FROM,
      to: [email.to],
      subject: email.subject,
    });
  });

  it('maps provider throttling without exposing its response body', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ message: 'sensitive provider diagnostic' }),
      { status: 429 },
    ));

    const failure = await sendTransactionalEmail(email, fetcher as typeof fetch)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmailProviderError);
    expect(failure).toMatchObject({ code: 'EMAIL_PROVIDER_RATE_LIMITED' });
    expect(String(failure)).not.toContain('sensitive provider diagnostic');
  });
});
