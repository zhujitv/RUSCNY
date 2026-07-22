import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Message, type Messaging } from 'firebase-admin/messaging';
import type { FriendCallMediaType, FriendCallPushKind } from '@prisma/client';
import { config } from '../config.js';

const firebaseAppName = 'friend-call-push';
const maximumCallPushTtlMs = 60_000;
const maximumMessagesPerSend = 500;

export interface FriendCallPushPayload {
  kind: FriendCallPushKind;
  callId: string;
  expiresAt: Date;
  mediaType?: FriendCallMediaType;
  callerDisplayName?: string;
}

export interface FriendCallPushTarget {
  registrationToken: string;
  bindingId: string;
}

export interface FriendCallPushSendResult {
  attempted: number;
  delivered: number;
  invalidTargets: FriendCallPushTarget[];
  retryableFailures: number;
  disabled: boolean;
}

type MessagingClient = Pick<Messaging, 'sendEach'>;

export async function sendFriendCallPush(
  payload: FriendCallPushPayload,
  pushTargets: FriendCallPushTarget[],
  messagingClient?: MessagingClient,
): Promise<FriendCallPushSendResult> {
  const targets = deduplicateTargets(pushTargets);
  if (targets.length === 0) {
    return {
      attempted: 0,
      delivered: 0,
      invalidTargets: [],
      retryableFailures: 0,
      disabled: false,
    };
  }
  if (config.PUSH_PROVIDER === 'disabled') {
    return {
      attempted: targets.length,
      delivered: 0,
      invalidTargets: [],
      retryableFailures: 0,
      disabled: true,
    };
  }
  assertPushPayload(payload);
  const ttl = Math.max(0, Math.min(maximumCallPushTtlMs, payload.expiresAt.getTime() - Date.now()));
  if (ttl === 0) {
    return {
      attempted: targets.length,
      delivered: 0,
      invalidTargets: [],
      retryableFailures: 0,
      disabled: false,
    };
  }

  const client = messagingClient ?? firebaseMessaging();
  const invalidTargets: FriendCallPushTarget[] = [];
  let delivered = 0;
  let retryableFailures = 0;
  for (let offset = 0; offset < targets.length; offset += maximumMessagesPerSend) {
    const batchTargets = targets.slice(offset, offset + maximumMessagesPerSend);
    const messages = batchTargets.map((target): Message => ({
      token: target.registrationToken,
      data: pushData(payload, target.bindingId),
      android: {
        priority: 'high',
        ttl,
        collapseKey: payload.callId,
        restrictedPackageName: config.ANDROID_PACKAGE_NAME,
      },
    }));
    const response = await client.sendEach(messages);
    delivered += response.successCount;
    response.responses.forEach((sendResult, index) => {
      if (sendResult.success) return;
      const code = sendResult.error?.code ?? 'messaging/unknown-error';
      if (isInvalidRegistrationCode(code)) {
        invalidTargets.push(batchTargets[index]!);
      } else {
        // Configuration, quota and transient provider failures remain retryable
        // until the short-lived durable job expires. This avoids losing a wake-up
        // because a provider request briefly failed after the call was committed.
        retryableFailures += 1;
      }
    });
  }
  return {
    attempted: targets.length,
    delivered,
    invalidTargets,
    retryableFailures,
    disabled: false,
  };
}

function pushData(payload: FriendCallPushPayload, bindingId: string): Record<string, string> {
  if (payload.kind === 'CANCEL') {
    return {
      schemaVersion: '1',
      event: 'friend.call.cancel',
      callId: payload.callId,
      bindingId,
    };
  }
  return {
    schemaVersion: '1',
    event: 'friend.call.incoming',
    callId: payload.callId,
    mediaType: payload.mediaType!,
    callerDisplayName: payload.callerDisplayName!,
    expiresAt: String(payload.expiresAt.getTime()),
    bindingId,
  };
}

function deduplicateTargets(targets: FriendCallPushTarget[]): FriendCallPushTarget[] {
  const uniqueTargets = new Map<string, FriendCallPushTarget>();
  for (const target of targets) {
    if (!target.registrationToken || !target.bindingId) continue;
    const key = `${target.registrationToken}\u0000${target.bindingId}`;
    if (!uniqueTargets.has(key)) uniqueTargets.set(key, target);
  }
  return [...uniqueTargets.values()];
}

function assertPushPayload(payload: FriendCallPushPayload): void {
  if (
    payload.kind === 'INCOMING' &&
    (!payload.mediaType || !payload.callerDisplayName)
  ) {
    throw new Error('Incoming friend-call push requires media type and caller display name');
  }
}

function isInvalidRegistrationCode(code: string): boolean {
  return [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/installation-id-not-registered',
  ].includes(code);
}

function firebaseMessaging(): Messaging {
  const existing = getApps().find((app) => app.name === firebaseAppName);
  const app = existing ?? createFirebaseApp();
  return getMessaging(app);
}

function createFirebaseApp(): App {
  if (!config.FCM_PROJECT_ID || !config.FCM_CLIENT_EMAIL || !config.FCM_PRIVATE_KEY) {
    throw new Error('FCM service account is not configured');
  }
  return initializeApp({
    credential: cert({
      projectId: config.FCM_PROJECT_ID,
      clientEmail: config.FCM_CLIENT_EMAIL,
      privateKey: config.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    projectId: config.FCM_PROJECT_ID,
  }, firebaseAppName);
}
