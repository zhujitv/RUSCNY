import type { Conversation, GuestHistoryPolicy } from '@prisma/client';
import type { AuthContext } from './lib/tokens.js';

export function historyExpiresAt(
  policy: GuestHistoryPolicy,
  endedAt: Date,
): Date | null {
  if (policy === 'PERMANENT') return null;
  if (policy === 'NO_ACCESS_AFTER_END') return endedAt;
  const hours = policy === 'ACCESS_FOR_7_DAYS' ? 24 * 7 : 24;
  return new Date(endedAt.getTime() + hours * 60 * 60 * 1_000);
}

export function guestHistoryAllowed(
  conversation: Pick<
    Conversation,
    'status' | 'guestHistoryPolicy' | 'guestAccessExpiresAt'
  >,
  now = new Date(),
): boolean {
  if (conversation.status !== 'ENDED') return conversation.status !== 'EXPIRED';
  if (conversation.guestHistoryPolicy === 'PERMANENT') return true;
  if (conversation.guestHistoryPolicy === 'NO_ACCESS_AFTER_END') return false;
  return Boolean(
    conversation.guestAccessExpiresAt && conversation.guestAccessExpiresAt > now,
  );
}

export function conversationScopeMatches(
  auth: AuthContext,
  conversation: Pick<Conversation, 'id' | 'ownerId'>,
): boolean {
  if (auth.role === 'GUEST') return auth.conversationId === conversation.id;
  return true;
}
