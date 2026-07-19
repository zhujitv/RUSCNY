import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';

const assetDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/admin-web',
);

const securityHeaders = (reply: FastifyReply) => reply
  .header('Content-Security-Policy', [
    "default-src 'self'",
    "connect-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '))
  .header('X-Frame-Options', 'DENY')
  .header('Referrer-Policy', 'no-referrer')
  .header('X-Content-Type-Options', 'nosniff');

async function sendAsset(
  reply: FastifyReply,
  filename: 'index.html' | 'app.js' | 'styles.css' | 'reset.html' | 'reset.js',
  contentType: string,
  noStore = false,
) {
  securityHeaders(reply);
  reply.header(
    'Cache-Control',
    noStore ? 'no-store' : 'public, max-age=300, must-revalidate',
  );
  const asset = await readFile(resolve(assetDirectory, filename));
  return reply.type(contentType).send(asset);
}

export async function registerAdminWebRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin', async (_request, reply) =>
    sendAsset(reply, 'index.html', 'text/html; charset=utf-8', true));
  app.get('/admin/', async (_request, reply) =>
    sendAsset(reply, 'index.html', 'text/html; charset=utf-8', true));
  app.get('/admin/app.js', async (_request, reply) =>
    sendAsset(reply, 'app.js', 'text/javascript; charset=utf-8'));
  app.get('/admin/styles.css', async (_request, reply) =>
    sendAsset(reply, 'styles.css', 'text/css; charset=utf-8'));
  app.get('/reset-password', async (_request, reply) =>
    sendAsset(reply, 'reset.html', 'text/html; charset=utf-8', true));
  app.get('/reset-password/reset.js', async (_request, reply) =>
    sendAsset(reply, 'reset.js', 'text/javascript; charset=utf-8'));
  app.get('/reset-password/styles.css', async (_request, reply) =>
    sendAsset(reply, 'styles.css', 'text/css; charset=utf-8'));
}
