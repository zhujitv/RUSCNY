import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/service-configuration.js', () => ({
  serviceConfiguration: vi.fn(async (key: string) => {
    if (key === 'ALIYUN_RTC_APP_ID') return 'artc_app_1';
    if (key === 'ALIYUN_RTC_APP_KEY') return 'server-only-artc-secret';
    if (key === 'ALIYUN_RTC_TOKEN_TTL_SECONDS') return '3600';
    return undefined;
  }),
}));

import { createAliyunRtcCredential } from '../src/services/aliyun-rtc.js';

describe('Aliyun ARTC credential', () => {
  it('uses one expiry value for the response and signed Base64 JSON', async () => {
    const now = new Date('2026-07-21T01:02:03.456Z');
    const credential = await createAliyunRtcCredential(
      'friend-call_1',
      'user-1_test',
      now,
    );
    const payload = JSON.parse(
      Buffer.from(credential.token, 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    const expectedTimestamp = Math.floor(now.getTime() / 1_000) + 3_600;
    const expectedSignature = createHash('sha256')
      .update(
        `artc_app_1server-only-artc-secretfriend-call_1user-1_test${expectedTimestamp}`,
        'utf8',
      )
      .digest('hex');

    expect(credential).toMatchObject({
      channelId: 'friend-call_1',
      userId: 'user-1_test',
      expiresAt: expectedTimestamp,
    });
    expect(payload).toEqual({
      appid: 'artc_app_1',
      channelid: credential.channelId,
      userid: credential.userId,
      nonce: '',
      timestamp: credential.expiresAt,
      token: expectedSignature,
    });
    expect(JSON.stringify(credential)).not.toContain('server-only-artc-secret');
  });
});
