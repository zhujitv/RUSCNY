import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@prisma/client';
import { config } from '../config.js';
import { unauthorized } from '../errors.js';

export type AuthRole = UserRole | 'GUEST';

export interface AuthContext {
  subjectId: string;
  role: AuthRole;
  deviceId: string;
  sessionId?: string;
  guestIdentityId?: string;
  conversationId?: string;
}

export interface RefreshContext {
  userId: string;
  deviceId: string;
  sessionId: string;
  familyId: string;
  jti: string;
}

const encoder = new TextEncoder();
const accessKey = () => encoder.encode(config.JWT_ACCESS_SECRET);
const refreshKey = () => encoder.encode(config.JWT_REFRESH_SECRET);

export async function signAccessToken(context: AuthContext): Promise<string> {
  if (!context.sessionId) {
    throw new Error('An access token requires a session');
  }
  // Guest access uses the same short TTL as registered access. A durable,
  // conversation-scoped principal capability renews it through a separate
  // server-side membership check; it is never promoted to a broad refresh JWT.
  const ttl = config.ACCESS_TOKEN_TTL_SECONDS;
  return new SignJWT({
    role: context.role,
    deviceId: context.deviceId,
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.guestIdentityId ? { guestIdentityId: context.guestIdentityId } : {}),
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(context.subjectId)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setJti(crypto.randomUUID())
    .sign(accessKey());
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), { algorithms: ['HS256'] });
    const rawRole = String(payload.role);
    const deviceId = payload.deviceId;
    const sessionId = payload.sessionId;
    if (
      !payload.sub ||
      !['USER', 'HOST', 'CUSTOMER', 'GUEST'].includes(rawRole) ||
      !deviceId ||
      !sessionId
    ) {
      throw new Error('invalid claims');
    }
    return {
      subjectId: payload.sub,
      // Access tokens issued before the unified-account migration used the
      // permanent HOST/CUSTOMER role. Normalize both to USER so rolling
      // deployments do not log out valid devices; meeting authority is still
      // resolved from server-side ownership and participation rows.
      role: rawRole === 'GUEST' ? 'GUEST' : 'USER',
      deviceId: String(deviceId),
      ...(sessionId ? { sessionId: String(sessionId) } : {}),
      ...(payload.guestIdentityId ? { guestIdentityId: String(payload.guestIdentityId) } : {}),
      ...(payload.conversationId ? { conversationId: String(payload.conversationId) } : {}),
    };
  } catch {
    throw unauthorized('TOKEN_INVALID', '登录凭证无效或已过期');
  }
}

export async function signRefreshToken(context: RefreshContext): Promise<string> {
  if (context.familyId !== context.sessionId) {
    throw new Error('A refresh-token family must match its device session');
  }
  return new SignJWT({
    type: 'refresh',
    deviceId: context.deviceId,
    sessionId: context.sessionId,
    familyId: context.familyId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(context.userId)
    .setJti(context.jti)
    .setIssuedAt()
    .setExpirationTime(`${config.REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(refreshKey());
}

export async function verifyRefreshToken(token: string): Promise<RefreshContext> {
  try {
    const { payload } = await jwtVerify(token, refreshKey(), { algorithms: ['HS256'] });
    if (
      !payload.sub ||
      !payload.jti ||
      payload.type !== 'refresh' ||
      !payload.deviceId ||
      !payload.sessionId ||
      !payload.familyId ||
      payload.familyId !== payload.sessionId
    ) {
      throw new Error('invalid claims');
    }
    return {
      userId: payload.sub,
      deviceId: String(payload.deviceId),
      sessionId: String(payload.sessionId),
      familyId: String(payload.familyId),
      jti: payload.jti,
    };
  } catch {
    throw unauthorized('REFRESH_TOKEN_INVALID', '刷新凭证无效或已过期');
  }
}
