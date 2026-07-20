import { createHmac, randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { serviceConfiguration } from './service-configuration.js';

export interface AliyunRtcCredential {
  channelId: string;
  userId: string;
  token: string;
  expiresAt: number;
}

interface AppTokenInput {
  appId: string;
  appKey: string;
  channelId: string;
  userId: string;
  expiresAt: number;
  issueTimestamp?: number;
  salt?: number;
}

const appTokenVersion = '000';
const audioPublishPrivilege = 0b0011;

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
  const issueTimestamp = Math.floor(now.getTime() / 1_000);
  const expiresAt = issueTimestamp + ttlSeconds;
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
      issueTimestamp,
    }),
  };
}

/**
 * Builds the DingRTC 3.0 AppToken documented by Alibaba Cloud. The AppKey is
 * used only for the two-stage HMAC on the server and is never included in the
 * returned credential.
 */
export function generateAliyunRtcToken(input: AppTokenInput): string {
  assertRtcIdentifier(input.appId, 'appId');
  assertRtcChannelId(input.channelId);
  assertRtcUserId(input.userId);
  const issueTimestamp = input.issueTimestamp ?? Math.floor(Date.now() / 1_000);
  const salt = input.salt ?? randomInt(1, Math.max(2, issueTimestamp));
  for (const [name, value] of Object.entries({
    issueTimestamp,
    salt,
    expiresAt: input.expiresAt,
  })) {
    if (!Number.isInteger(value) || value <= 0 || value > 0x7fffffff) {
      throw new Error(`Invalid RTC AppToken ${name}`);
    }
  }
  if (input.expiresAt <= issueTimestamp || input.expiresAt - issueTimestamp > 86_400) {
    throw new Error('RTC AppToken lifetime must be between 1 second and 24 hours');
  }

  const timestampBytes = int32(issueTimestamp);
  const signingSeed = createHmac('sha256', timestampBytes)
    .update(input.appKey, 'utf8')
    .digest();
  const signKey = createHmac('sha256', int32(salt)).update(signingSeed).digest();

  const service = new BinaryWriter()
    .writeString(input.channelId)
    .writeString(input.userId)
    .writeBool(true)
    .writeInt32(audioPublishPrivilege)
    .build();
  // The official AppTokenOptions wire format always includes the options map.
  // No channel override is required here, so an empty map is encoded.
  const options = new BinaryWriter().writeBool(true).writeInt32(0).build();
  const compactBody = new BinaryWriter()
    .writeString(input.appId)
    .writeInt32(issueTimestamp)
    .writeInt32(salt)
    .writeInt32(input.expiresAt)
    .writeBytes(service)
    .writeBytes(options)
    .build();
  // Alibaba's official DingRTC 3.0 AppToken ByteBuffer starts at 256 bytes,
  // grows by powers of two, and signs/serializes the entire allocated buffer.
  // The zero padding is therefore part of the wire format, not optional.
  const body = officialBuffer(compactBody);
  const signature = createHmac('sha256', signKey).update(body).digest();
  const compactPayload = new BinaryWriter()
    .writeInt32(signature.length)
    .writeBytes(signature)
    .writeBytes(body)
    .build();
  const payload = officialBuffer(compactPayload);
  return `${appTokenVersion}${deflateSync(payload).toString('base64')}`;
}

export class AliyunRtcNotConfiguredError extends Error {}

function assertRtcIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error(`Invalid RTC ${name}`);
  }
}

function assertRtcChannelId(value: string): void {
  // DingRTC 3.0 accepts only ASCII letters, digits, and hyphens here.
  // In particular, base64url underscores are not valid channel characters.
  if (value === '0' || !/^[A-Za-z0-9-]{1,64}$/.test(value)) {
    throw new Error('Invalid RTC channelId');
  }
}

function assertRtcUserId(value: string): void {
  if (!/^[A-Za-z0-9]{1,64}$/.test(value)) {
    throw new Error('Invalid RTC userId');
  }
}

function int32(value: number): Buffer {
  const result = Buffer.allocUnsafe(4);
  result.writeInt32BE(value);
  return result;
}

function officialBuffer(value: Buffer): Buffer {
  let capacity = 256;
  while (capacity < value.length) capacity *= 2;
  const result = Buffer.alloc(capacity);
  value.copy(result);
  return result;
}

class BinaryWriter {
  private readonly chunks: Buffer[] = [];

  writeBool(value: boolean): this {
    this.chunks.push(Buffer.from([value ? 1 : 0]));
    return this;
  }

  writeInt32(value: number): this {
    this.chunks.push(int32(value));
    return this;
  }

  writeString(value: string): this {
    const bytes = Buffer.from(value, 'utf8');
    return this.writeInt32(bytes.length).writeBytes(bytes);
  }

  writeBytes(value: Buffer): this {
    this.chunks.push(value);
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
