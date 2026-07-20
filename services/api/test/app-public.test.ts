import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, normalizeError, requestLogUrl } from '../src/app.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('public Fastify surface without realtime or database queries', () => {
  it('keeps Fastify rate-limit failures as a stable 429 envelope', () => {
    const error = Object.assign(new Error('rate limit exceeded'), { statusCode: 429 });
    expect(normalizeError(error)).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('strips capability query strings before request logging', () => {
    expect(
      requestLogUrl('/v1/audio/assets/tts-a.mp3?expires=123&signature=secret'),
    ).toBe('/v1/audio/assets/tts-a.mp3');
    expect(requestLogUrl('/join/invite_token_1234567890')).toBe('/join/[redacted]');
  });

  it('reports process liveness', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { status: 'live' } });
  });

  it('serves the bilingual customer website at the root route', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['content-security-policy']).toContain("media-src https://media.ruscny.net");
    expect(response.body).toContain('src="/logo-mark.svg"');
    expect(response.body).toContain('RUSCNY');
    expect(response.body).toContain('中俄实时语音翻译');
    expect(response.body).toContain('/privacy');
    expect(response.body).toContain('/terms');
  });

  it('serves the official vector logo assets', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const [mark, lockup] = await Promise.all([
      app.inject({ method: 'GET', url: '/logo-mark.svg' }),
      app.inject({ method: 'GET', url: '/logo-lockup.svg' }),
    ]);

    for (const response of [mark, lockup]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/svg+xml');
      expect(response.body).toContain('<svg');
      expect(response.body).toContain('RUSCNY');
    }
  });

  it('permanently redirects the apex domain to the canonical www origin', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({
      method: 'GET',
      url: '/join/browser_invite_token_1234567890?source=qr',
      headers: { host: 'ruscny.net' },
    });

    expect(response.statusCode).toBe(308);
    expect(response.headers.location).toBe(
      'https://www.ruscny.net/join/browser_invite_token_1234567890?source=qr',
    );
  });

  it('does not redirect Railway health checks or the canonical www domain', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const [railwayHealth, canonicalHome] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { host: 'api-production-639d.up.railway.app' },
      }),
      app.inject({ method: 'GET', url: '/', headers: { host: 'www.ruscny.net' } }),
    ]);

    expect(railwayHealth.statusCode).toBe(200);
    expect(canonicalHome.statusCode).toBe(200);
  });

  it('keeps service metadata available at the versioned API root', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({ method: 'GET', url: '/v1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: { service: 'zh-ru-translator-api', version: '0.1.0' },
    });
  });

  it('serves customer site assets and bilingual legal pages', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const [script, accountScript, styles, account, register, login, privacy, terms, socialCard, callScreenZh, callScreenRu, robots, sitemap] = await Promise.all([
      app.inject({ method: 'GET', url: '/site.js' }),
      app.inject({ method: 'GET', url: '/account.js' }),
      app.inject({ method: 'GET', url: '/site.css' }),
      app.inject({ method: 'GET', url: '/account' }),
      app.inject({ method: 'GET', url: '/register' }),
      app.inject({ method: 'GET', url: '/login' }),
      app.inject({ method: 'GET', url: '/privacy' }),
      app.inject({ method: 'GET', url: '/terms' }),
      app.inject({ method: 'GET', url: '/og.png' }),
      app.inject({ method: 'GET', url: '/friend-call-live-ui.png' }),
      app.inject({ method: 'GET', url: '/friend-call-live-ui-ru.png' }),
      app.inject({ method: 'GET', url: '/robots.txt' }),
      app.inject({ method: 'GET', url: '/sitemap.xml' }),
    ]);

    expect(script.statusCode).toBe(200);
    expect(script.body).toContain('Разные языки');
    expect(script.body).not.toContain('innerHTML');
    expect(accountScript.statusCode).toBe(200);
    expect(accountScript.body).toContain("'/v1/auth/register'");
    expect(accountScript.body).not.toContain('innerHTML');
    expect(styles.statusCode).toBe(200);
    expect(styles.body).toContain('.hero-product');
    expect(styles.body).toContain('.auth-card');
    expect(account.statusCode).toBe(200);
    expect(account.headers['cache-control']).toBe('no-store');
    expect(account.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(account.body).toContain('id="account-form"');
    expect(account.body).toContain('name="preferredLanguage"');
    expect(register.statusCode).toBe(200);
    expect(login.statusCode).toBe(200);
    expect(privacy.body).toContain('隐私政策');
    expect(terms.body).toContain('用户协议');
    expect(socialCard.headers['content-type']).toContain('image/png');
    expect(socialCard.rawPayload.length).toBeGreaterThan(10_000);
    for (const callScreen of [callScreenZh, callScreenRu]) {
      expect(callScreen.statusCode).toBe(200);
      expect(callScreen.headers['content-type']).toContain('image/png');
      expect(callScreen.rawPayload.length).toBeGreaterThan(40_000);
    }
    expect(robots.body).toContain('Disallow: /admin');
    expect(robots.body).toContain('Disallow: /account');
    expect(sitemap.body).toContain('https://www.ruscny.net/privacy');
  });

  it('serves the no-store administrator console with a restrictive CSP', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({ method: 'GET', url: '/admin' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.body).toContain('Server Console');
  });

  it('serves an administrator client that fails closed after terminal auth errors', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({ method: 'GET', url: '/admin/app.js' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('let refreshInFlight = null');
    expect(response.body).toContain('let terminalAuthFailureHandled = false');
    expect(response.body).toContain('if (terminalAuthFailureHandled) return');
    expect(response.body).toContain('clearCredentials();');
    expect(response.body).toContain("error.code === 'SYSTEM_ADMIN_REQUIRED'");
    expect(response.body).toContain('handleAdminAuthFailure(error)');
    expect(response.body).toContain('if (!error.authHandled) toast(error.message, true)');
  });

  it('does not persist a password-reset fragment in the HTTP request surface', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({ method: 'GET', url: '/reset-password' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('/reset-password/reset.js');
  });

  it('uses the stable error envelope for unknown routes', async () => {
    app = await buildApp({ logger: false, realtime: false });
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      message: '接口不存在',
    });
  });
});
