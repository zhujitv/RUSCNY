import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from './auth.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { forbidden } from './errors.js';

export function configuredSystemAdminUserIds(value = config.SYSTEM_ADMIN_USER_IDS): Set<string> {
  return new Set(
    value
      .split(',')
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
}

export function isSystemAdminRecord(
  user: {
    id: string;
    status: string;
    isSystemAdmin: boolean;
  },
  configuredUserIds = configuredSystemAdminUserIds(),
): boolean {
  return user.status === 'ACTIVE' && (
    user.isSystemAdmin || configuredUserIds.has(user.id)
  );
}

/**
 * System administration is deliberately re-read from PostgreSQL on every
 * request. Product role claims in the access token and any browser value are
 * never treated as administrator authority.
 */
export async function requireSystemAdmin(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  await authenticate(request);
  if (request.auth.role === 'GUEST') {
    throw forbidden('SYSTEM_ADMIN_REQUIRED', '需要服务器管理员权限');
  }
  const user = await prisma.user.findUnique({
    where: { id: request.auth.subjectId },
    select: {
      id: true,
      status: true,
      isSystemAdmin: true,
    },
  });
  if (!user || !isSystemAdminRecord(user)) {
    throw forbidden('SYSTEM_ADMIN_REQUIRED', '需要服务器管理员权限');
  }
}
