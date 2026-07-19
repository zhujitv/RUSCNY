import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { forbidden, unauthorized } from './errors.js';
import { verifyAccessToken, type AuthRole } from './lib/tokens.js';

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  return header.slice(7).trim();
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  const auth = await verifyAccessToken(bearerToken(request));
  await validateAuthContext(auth);
  request.auth = auth;
}

export async function validateAuthContext(auth: Awaited<ReturnType<typeof verifyAccessToken>>): Promise<void> {
  if (auth.role === 'GUEST') {
    const guest = await prisma.guestIdentity.findUnique({
      where: { id: auth.guestIdentityId ?? auth.subjectId },
      select: { revokedAt: true, expiresAt: true, conversationId: true, sessionId: true },
    });
    if (
      !guest ||
      guest.revokedAt ||
      guest.expiresAt <= new Date() ||
      guest.conversationId !== auth.conversationId ||
      !auth.sessionId ||
      guest.sessionId !== auth.sessionId
    ) {
      throw unauthorized('GUEST_TOKEN_REVOKED', '访客身份已失效');
    }
  } else {
    const user = await prisma.user.findUnique({
      where: { id: auth.subjectId },
      select: {
        status: true,
        devices: {
          where: { deviceId: auth.deviceId },
          select: { revokedAt: true, sessionId: true },
          take: 1,
        },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw unauthorized('ACCOUNT_DISABLED', '账号不存在或已停用');
    }
    if (
      !user.devices[0] ||
      user.devices[0].revokedAt ||
      !auth.sessionId ||
      user.devices[0].sessionId !== auth.sessionId
    ) {
      throw unauthorized('DEVICE_REVOKED', '此设备登录已被撤销');
    }
  }
}

export const requireRole = (...roles: AuthRole[]) =>
  async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await authenticate(request);
    if (!roles.includes(request.auth.role)) throw forbidden();
  };
