import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export interface EmailSendResult {
  providerMessageId: string;
}

export class EmailProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

const resendResponseSchema = z.object({ id: z.string().min(1).max(500) });

export async function sendTransactionalEmail(
  email: TransactionalEmail,
  fetcher: typeof fetch = fetch,
): Promise<EmailSendResult> {
  if (config.EMAIL_PROVIDER === 'mock') {
    return {
      providerMessageId: `mock-${createHash('sha256')
        .update(email.idempotencyKey)
        .digest('hex')
        .slice(0, 24)}`,
    };
  }
  if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
    throw new EmailProviderError('EMAIL_NOT_CONFIGURED', '邮件服务尚未配置');
  }

  let response: Response;
  try {
    response = await fetcher(`${config.RESEND_API_BASE_URL.replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(config.EMAIL_REPLY_TO ? { reply_to: config.EMAIL_REPLY_TO } : {}),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(config.EMAIL_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new EmailProviderError('EMAIL_PROVIDER_UNAVAILABLE', '邮件服务暂时不可用');
  }

  if (!response.ok) {
    throw new EmailProviderError(
      response.status === 429 ? 'EMAIL_PROVIDER_RATE_LIMITED' : 'EMAIL_PROVIDER_REJECTED',
      response.status === 429 ? '邮件发送频率受限，请稍后重试' : '邮件服务拒绝了发送请求',
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EmailProviderError('EMAIL_PROVIDER_INVALID_RESPONSE', '邮件服务返回无效结果');
  }
  const parsed = resendResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new EmailProviderError('EMAIL_PROVIDER_INVALID_RESPONSE', '邮件服务返回无效结果');
  }
  return { providerMessageId: parsed.data.id };
}
