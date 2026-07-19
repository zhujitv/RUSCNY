import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';

const joinDirectory = new URL('../../../../deploy/deep-links/site/join/', import.meta.url);

interface JoinAssets {
  html: string;
  script: string;
  styles: string;
}

export async function registerWebGuestRoutes(app: FastifyInstance): Promise<void> {
  // Load the committed files during startup. A production image missing the
  // browser client must fail before becoming ready instead of returning a
  // partially functional invitation page.
  const assets: JoinAssets = {
    html: await readFile(new URL('index.html', joinDirectory), 'utf8'),
    script: await readFile(new URL('app.js', joinDirectory), 'utf8'),
    styles: await readFile(new URL('styles.css', joinDirectory), 'utf8'),
  };

  app.get('/join/app.js', async (_request, reply) => {
    setJoinAssetHeaders(reply, 'text/javascript; charset=utf-8');
    return assets.script;
  });

  app.get('/join/styles.css', async (_request, reply) => {
    setJoinAssetHeaders(reply, 'text/css; charset=utf-8');
    return assets.styles;
  });

  const renderJoinPage = async (_request: unknown, reply: FastifyReply) => {
    setJoinPageHeaders(reply);
    return assets.html;
  };

  app.get('/join', renderJoinPage);
  app.get('/join/', renderJoinPage);
  app.get('/join/:token', async (request, reply) => {
    const token = String((request.params as { token?: unknown }).token ?? '');
    if (!isInviteTokenPathSegment(token)) {
      await reply.code(404).send({
        ok: false,
        code: 'INVALID_INVITATION_LINK',
        message: '邀请链接格式无效',
      });
      return;
    }
    return renderJoinPage(request, reply);
  });
}

export function isInviteTokenPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,256}$/.test(value);
}

function setJoinAssetHeaders(reply: FastifyReply, contentType: string): void {
  reply
    .type(contentType)
    .header('Cache-Control', 'public, max-age=300, must-revalidate')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'no-referrer');
}

function setJoinPageHeaders(reply: FastifyReply): void {
  reply
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'private, no-store, max-age=0')
    .header('Pragma', 'no-cache')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Content-Type-Options', 'nosniff')
    .header('X-Frame-Options', 'DENY')
    .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
    .header(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join('; '),
    );
}
