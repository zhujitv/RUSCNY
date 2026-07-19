import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';

const siteDirectory = new URL('../../../../apps/customer-web/', import.meta.url);

interface CustomerSiteAssets {
  index: string;
  account: string;
  privacy: string;
  terms: string;
  script: string;
  accountScript: string;
  styles: string;
  logoMark: string;
  logoLockup: string;
  og: Buffer;
}

const pageHeaders = (reply: FastifyReply) => reply
  .header('Cache-Control', 'public, max-age=0, must-revalidate')
  .header('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src https://media.ruscny.net",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '))
  .header('X-Frame-Options', 'DENY')
  .header('Referrer-Policy', 'strict-origin-when-cross-origin')
  .header('X-Content-Type-Options', 'nosniff')
  .type('text/html; charset=utf-8');

const assetHeaders = (reply: FastifyReply, contentType: string) => reply
  .header('Cache-Control', 'public, max-age=300, must-revalidate')
  .header('X-Content-Type-Options', 'nosniff')
  .header('Referrer-Policy', 'strict-origin-when-cross-origin')
  .type(contentType);

const accountPageHeaders = (reply: FastifyReply) => pageHeaders(reply)
  .header('Cache-Control', 'no-store')
  .header('Pragma', 'no-cache');

export async function registerCustomerWebRoutes(app: FastifyInstance): Promise<void> {
  const assets: CustomerSiteAssets = {
    index: await readFile(new URL('index.html', siteDirectory), 'utf8'),
    account: await readFile(new URL('account.html', siteDirectory), 'utf8'),
    privacy: await readFile(new URL('privacy.html', siteDirectory), 'utf8'),
    terms: await readFile(new URL('terms.html', siteDirectory), 'utf8'),
    script: await readFile(new URL('app.js', siteDirectory), 'utf8'),
    accountScript: await readFile(new URL('account.js', siteDirectory), 'utf8'),
    styles: await readFile(new URL('styles.css', siteDirectory), 'utf8'),
    logoMark: await readFile(new URL('assets/logo-mark.svg', siteDirectory), 'utf8'),
    logoLockup: await readFile(new URL('assets/logo-lockup.svg', siteDirectory), 'utf8'),
    og: await readFile(new URL('og.png', siteDirectory)),
  };

  app.get('/', async (_request, reply) => pageHeaders(reply).send(assets.index));
  app.get('/account', async (_request, reply) => accountPageHeaders(reply).send(assets.account));
  app.get('/register', async (_request, reply) => accountPageHeaders(reply).send(assets.account));
  app.get('/login', async (_request, reply) => accountPageHeaders(reply).send(assets.account));
  app.get('/privacy', async (_request, reply) => pageHeaders(reply).send(assets.privacy));
  app.get('/terms', async (_request, reply) => pageHeaders(reply).send(assets.terms));
  app.get('/site.js', async (_request, reply) =>
    assetHeaders(reply, 'text/javascript; charset=utf-8').send(assets.script));
  app.get('/account.js', async (_request, reply) =>
    assetHeaders(reply, 'text/javascript; charset=utf-8').send(assets.accountScript));
  app.get('/site.css', async (_request, reply) =>
    assetHeaders(reply, 'text/css; charset=utf-8').send(assets.styles));
  app.get('/logo-mark.svg', async (_request, reply) =>
    assetHeaders(reply, 'image/svg+xml; charset=utf-8').send(assets.logoMark));
  app.get('/logo-lockup.svg', async (_request, reply) =>
    assetHeaders(reply, 'image/svg+xml; charset=utf-8').send(assets.logoLockup));
  app.get('/og.png', async (_request, reply) => reply
    .header('Cache-Control', 'public, max-age=86400, immutable')
    .header('X-Content-Type-Options', 'nosniff')
    .type('image/png')
    .send(assets.og));
  app.get('/robots.txt', async (_request, reply) => reply
    .header('Cache-Control', 'public, max-age=3600')
    .type('text/plain; charset=utf-8')
    .send('User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /register\nDisallow: /login\nDisallow: /admin\nDisallow: /join\nSitemap: https://www.ruscny.net/sitemap.xml\n'));
  app.get('/sitemap.xml', async (_request, reply) => reply
    .header('Cache-Control', 'public, max-age=3600')
    .type('application/xml; charset=utf-8')
    .send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.ruscny.net/</loc></url><url><loc>https://www.ruscny.net/privacy</loc></url><url><loc>https://www.ruscny.net/terms</loc></url></urlset>'));
}
