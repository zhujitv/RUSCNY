import { createHash } from 'node:crypto';
import { serviceConfiguration } from './service-configuration.js';

export interface AliyunRtcCredential {
  channelId: string;
  userId: string;
  token: string;
  expiresAt: number;
}

interface ArtcTokenInput {
  appId: string;
  appKey: string;
  channelId: string;
  userId: string;
  expiresAt: number;
}

interface ArtcTokenPayload {
  appid: string;
  channelid: string;
  userid: string;
  nonce: '';
  timestamp: number;
  token: string;
}

export async function createAliyunRtcCredential(
  channelId: string,
  userId: string,
  now = new Date(),
): Promise<AliyunRtcCredential> {
  assertRtcChannelId(channelId);
  assertRtcUserId(userId);
  const [appId, appKey, ttlValue] = await Promise.all([
    serviceConfiguration('ALIYUN_RTC_APP_ID'),
    serviceConfiguration('ALIYUN_RTC_APP_KEY'),
    serviceConfiguration('ALIYUN_RTC_TOKEN_TTL_SECONDS'),
  ]);
  if (!appId || !appKey) throw new AliyunRtcNotConfiguredError();
  const ttlSeconds = Number(ttlValue ?? 3_600);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) {
    throw new Error('ALIYUN_RTC_TOKEN_TTL_SECONDS is invalid');
  }
  const expiresAt = Math.floor(now.getTime() / 1_000) + ttlSeconds;
  return {
    channelId,
    userId,
    expiresAt,
    token: generateAliyunRtcToken({
      appId,
      appKey,
      channelId,
      userId,
      expiresAt,
    }),
  };
}

/**
 * Builds the single-argument token accepted by AliVCSDK_ARTC. AppKey is used
 * only for the server-side SHA-256 signature and is never serialized.
 */
export function generateAliyunRtcToken(input: ArtcTokenInput): string {
  assertRtcAppId(input.appId);
  assertRtcChannelId(input.channelId);
  assertRtcUserId(input.userId);
  if (!input.appKey) throw new Error('Invalid RTC appKey');
  if (!Number.isInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new Error('Invalid RTC timestamp');
  }

  const nonce = '';
  const signature = createHash('sha256')
    .update(
      `${input.appId}${input.appKey}${input.channelId}${input.userId}${nonce}${input.expiresAt}`,
      'utf8',
    )
    .digest('hex');
  const payload: ArtcTokenPayload = {
    appid: input.appId,
    channelid: input.channelId,
    userid: input.userId,
    nonce,
    timestamp: input.expiresAt,
    token: signature,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export class AliyunRtcNotConfiguredError extends Error {}

function assertRtcAppId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error('Invalid RTC appId');
  }
}

function assertRtcChannelId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error('Invalid RTC channelId');
  }
}

function assertRtcUserId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error('Invalid RTC userId');
  }
}
