import type {
  ConversationStatus,
  GuestHistoryPolicy,
  Language,
  ParticipantPresence,
  Prisma,
} from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { unauthorized } from '../errors.js';
import { secretHash } from '../lib/crypto.js';
import { guestHistoryAllowed } from '../policies.js';

const GUEST_REFRESH_COALESCE_MS = 10_000;

type LockedConversation = {
  id: string;
  status: ConversationStatus;
  guestHistoryPolicy: GuestHistoryPolicy;
  guestAccessExpiresAt: Date | null;
  expiresAt: Date;
};

type LockedGuestPrincipal = {
  id: string;
  revokedAt: Date | null;
  lastSeenAt: Date;
};

type LockedGuestIdentity = {
  id: string;
  sessionId: string;
  displayName: string;
  company: string | null;
  email: string | null;
  preferredLanguage: Language;
  deviceId: string;
  conversationId: string;
  guestPrincipalId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
};

type LockedGuestParticipant = {
  id: string;
  conversationId: string;
  guestIdentityId: string | null;
  presence: ParticipantPresence;
  leftAt: Date | null;
  removedAt: Date | null;
};

export interface RefreshedGuestSession {
  id: string;
  sessionId: string;
  displayName: string;
  company: string | null;
  email: string | null;
  preferredLanguage: Language;
  deviceId: string;
  conversationId: string;
}

/**
 * Expires the currently committed generation after a Guest bearer token has
 * already passed authenticate(). The transaction intentionally does not CAS
 * on that token's old sessionId: if a concurrent automatic renewal commits
 * between authentication and this lock, the user's explicit logout must also
 * invalidate the newly committed generation instead of silently doing
 * nothing. A stale token cannot start this operation after rotation because
 * authenticate() rejects it against GuestIdentity.sessionId.
 */
export async function logoutGuestSession(input: {
  guestIdentityId: string;
  conversationId: string;
  deviceId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const conversation = (await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Conversation"
      WHERE "id" = ${input.conversationId}
      FOR UPDATE
    `)[0];
    if (!conversation) return false;

    const identity = (await tx.$queryRaw<LockedGuestIdentity[]>`
      SELECT "id", "sessionId", "displayName", "company", "email", "preferredLanguage",
             "deviceId", "conversationId", "guestPrincipalId", "expiresAt", "revokedAt"
      FROM "GuestIdentity"
      WHERE "id" = ${input.guestIdentityId}
      FOR UPDATE
    `)[0];
    if (
      !identity ||
      identity.revokedAt ||
      identity.conversationId !== conversation.id ||
      identity.deviceId !== input.deviceId
    ) {
      return false;
    }

    // Keep the same lock order as renewal before applying lifecycle writes.
    await tx.$queryRaw<LockedGuestParticipant[]>`
      SELECT "id", "conversationId", "guestIdentityId", "presence", "leftAt", "removedAt"
      FROM "Participant"
      WHERE "conversationId" = ${conversation.id}
        AND "guestIdentityId" = ${identity.id}
      FOR UPDATE
    `;

    const expired = await tx.guestIdentity.updateMany({
      where: {
        id: identity.id,
        conversationId: conversation.id,
        deviceId: input.deviceId,
        revokedAt: null,
      },
      data: {
        expiresAt: now,
        sessionId: secretHash(
          `guest-logout-session-v1:${identity.id}:${now.toISOString()}`,
          config.PASSWORD_PEPPER,
        ),
      },
    });
    if (expired.count !== 1) return false;
    await tx.participant.updateMany({
      where: { guestIdentityId: identity.id, removedAt: null },
      data: {
        presence: 'LEFT',
        leftAt: now,
        lastSeenAt: now,
      },
    });
    return true;
  }, { isolationLevel: 'ReadCommitted' as Prisma.TransactionIsolationLevel });
}

/**
 * Renews a scoped Guest session without consulting a shared invitation.
 *
 * The caller is identified exclusively by the peppered GuestPrincipal token
 * digest.  The device id must match byte-for-byte: the principal capability
 * is deliberately not a portable bearer credential.  Clearing browser/app
 * storage therefore requires a fresh invitation instead of silently moving a
 * guest identity to another device.
 *
 * Rows are locked in the same Conversation -> Principal -> GuestIdentity ->
 * Participant order for every renewal.  A short deterministic generation
 * window makes concurrent 401 recovery idempotent: parallel renewals converge
 * on one session id instead of the later response invalidating the earlier
 * response immediately.
 */
export async function refreshGuestSession(input: {
  guestPrincipalToken: string;
  conversationId: string;
  deviceId: string;
  now?: Date;
}): Promise<RefreshedGuestSession> {
  const now = input.now ?? new Date();
  const tokenHash = secretHash(
    `guest-principal-v1:${input.guestPrincipalToken}`,
    config.PASSWORD_PEPPER,
  );

  return prisma.$transaction(async (tx) => {
    const conversation = (await tx.$queryRaw<LockedConversation[]>`
      SELECT "id", "status", "guestHistoryPolicy", "guestAccessExpiresAt", "expiresAt"
      FROM "Conversation"
      WHERE "id" = ${input.conversationId}
      FOR UPDATE
    `)[0];

    // Do not fall back to deviceId, identity id, participant id, or an invite.
    // The keyed digest is the only guest-principal lookup credential here.
    const principal = (await tx.$queryRaw<LockedGuestPrincipal[]>`
      SELECT "id", "revokedAt", "lastSeenAt"
      FROM "GuestPrincipal"
      WHERE "tokenHash" = ${tokenHash}
      FOR UPDATE
    `)[0];

    if (!conversation || !principal || principal.revokedAt) {
      throw invalidGuestRefresh();
    }

    const identity = (await tx.$queryRaw<LockedGuestIdentity[]>`
      SELECT "id", "sessionId", "displayName", "company", "email", "preferredLanguage",
             "deviceId", "conversationId", "guestPrincipalId", "expiresAt", "revokedAt"
      FROM "GuestIdentity"
      WHERE "conversationId" = ${conversation.id}
        AND "guestPrincipalId" = ${principal.id}
      FOR UPDATE
    `)[0];
    if (!identity) throw invalidGuestRefresh();

    const participant = (await tx.$queryRaw<LockedGuestParticipant[]>`
      SELECT "id", "conversationId", "guestIdentityId", "presence", "leftAt", "removedAt"
      FROM "Participant"
      WHERE "conversationId" = ${conversation.id}
        AND "guestIdentityId" = ${identity.id}
      FOR UPDATE
    `)[0];

    const activeRoom =
      (conversation.status === 'WAITING' || conversation.status === 'ACTIVE') &&
      conversation.expiresAt > now;
    const readableHistory =
      conversation.status === 'ENDED' && guestHistoryAllowed(conversation, now);
    const activeParticipant =
      participant?.leftAt === null &&
      (participant.presence === 'ONLINE' || participant.presence === 'OFFLINE');

    if (
      identity.revokedAt ||
      identity.expiresAt <= now ||
      identity.conversationId !== conversation.id ||
      identity.guestPrincipalId !== principal.id ||
      identity.deviceId !== input.deviceId ||
      !participant ||
      participant.removedAt ||
      participant.conversationId !== conversation.id ||
      participant.guestIdentityId !== identity.id ||
      (!activeRoom && !readableHistory) ||
      (activeRoom && !activeParticipant)
    ) {
      throw invalidGuestRefresh();
    }

    const newGeneration =
      principal.lastSeenAt.getTime() < now.getTime() - GUEST_REFRESH_COALESCE_MS;
    const generationAnchor = newGeneration ? now : principal.lastSeenAt;
    const sessionId = guestRefreshSessionId(
      principal.id,
      conversation.id,
      identity.deviceId,
      generationAnchor,
    );

    if (newGeneration) {
      const touched = await tx.guestPrincipal.updateMany({
        where: { id: principal.id, tokenHash, revokedAt: null },
        data: { lastSeenAt: generationAnchor },
      });
      if (touched.count !== 1) throw invalidGuestRefresh();
    }

    // The row locks make this linearizable; the old session predicate is a
    // final CAS guard against future callers changing the transaction shape.
    const rotated = await tx.guestIdentity.updateMany({
      where: {
        id: identity.id,
        conversationId: conversation.id,
        guestPrincipalId: principal.id,
        deviceId: input.deviceId,
        sessionId: identity.sessionId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { sessionId },
    });
    if (rotated.count !== 1) throw invalidGuestRefresh();

    return {
      id: identity.id,
      sessionId,
      displayName: identity.displayName,
      company: identity.company,
      email: identity.email,
      preferredLanguage: identity.preferredLanguage,
      deviceId: identity.deviceId,
      conversationId: identity.conversationId,
    };
  }, { isolationLevel: 'ReadCommitted' as Prisma.TransactionIsolationLevel });
}

function guestRefreshSessionId(
  principalId: string,
  conversationId: string,
  deviceId: string,
  anchor: Date,
): string {
  return secretHash(
    `guest-refresh-session-v1:${principalId}:${conversationId}:${deviceId}:${anchor.toISOString()}`,
    config.PASSWORD_PEPPER,
  );
}

function invalidGuestRefresh() {
  // Every credential, membership, lifecycle, and device failure has the same
  // response.  The endpoint cannot be used to enumerate principals or rooms.
  return unauthorized('GUEST_REFRESH_INVALID', '访客会话无法续期');
}
