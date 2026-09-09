/**
 * Luster SMS uses the platform sender and credit ledger. Historical salon-owned
 * connections retain their identity for history and signature verification, but
 * cannot send or silently fall through to a different texting number.
 */

import 'server-only';

import { Env } from '@/libs/Env';

export const LUSTER_DEFAULT_SENDER_IDENTITY = 'luster_shared_v1';

export type SmsSenderMode = 'shared_luster' | 'connected_byo' | 'disabled';

export type SmsUnavailableReason =
  | 'SMS_DISABLED'
  | 'GLOBAL_SMS_DISABLED'
  | 'NO_CREDITS'
  | 'SENDER_NOT_READY'
  | 'CONSENT_REQUIRED'
  | 'GLOBAL_OPT_OUT'
  | 'PILOT_NOT_ENABLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'DESTINATION_NOT_SUPPORTED';

export type TwilioConnectionSnapshot = {
  status: string;
  connectAccountSid: string;
  messagingServiceSid: string | null;
  phoneNumber: string | null;
};

/** Preserve a historical sender identity so retirement fails closed in place. */
export function resolveSmsSenderMode(input: {
  connection: TwilioConnectionSnapshot | null;
  perSalonDisabled: boolean;
}): SmsSenderMode {
  if (input.perSalonDisabled) {
    return 'disabled';
  }
  // An existing connection is an explicit salon identity, even while setup
  // is incomplete or revoked. Readiness fails in place; never substitute
  // the platform number for a broken connected sender.
  if (input.connection !== null) {
    return 'connected_byo';
  }
  return 'shared_luster';
}

export type SharedSenderRuntimeConfig = {
  communicationsSmsEnabled: boolean;
  messagingServiceSid: string | null;
  accountSidPresent: boolean;
  authTokenPresent: boolean;
  senderIdentity: string;
  pilot: { enabled: boolean; allowlist: readonly string[] };
  /** Migration B singleton — null until it exists; null FAILS CLOSED. */
  platformControl: { smsEnabled: boolean } | null;
  /** Migration A credit wiring — null until it exists; null FAILS CLOSED. */
  creditReservation: { available: true } | null;
};

/** The shared sender deliberately has NO phone-number field (contract §9.1). */
export type SharedSenderResolution =
  | {
    ready: true;
    mode: 'shared_luster';
    messagingServiceSid: string;
    senderIdentity: string;
  }
  | {
    ready: false;
    mode: 'shared_luster';
    reason: Extract<SmsUnavailableReason, 'GLOBAL_SMS_DISABLED' | 'SENDER_NOT_READY' | 'PILOT_NOT_ENABLED'>;
  };

export function resolveSharedSenderReadiness(input: {
  salonSlug: string;
  config: SharedSenderRuntimeConfig;
}): SharedSenderResolution {
  const { config } = input;

  if (!config.communicationsSmsEnabled) {
    return { ready: false, mode: 'shared_luster', reason: 'GLOBAL_SMS_DISABLED' };
  }

  // Unbuilt dependencies fail closed as ABSENCE, not as a hardcoded flag:
  // when Migration B lands, passing a real control row flips behavior
  // without touching this function.
  if (config.platformControl === null) {
    return { ready: false, mode: 'shared_luster', reason: 'SENDER_NOT_READY' };
  }
  if (config.platformControl.smsEnabled !== true) {
    return { ready: false, mode: 'shared_luster', reason: 'GLOBAL_SMS_DISABLED' };
  }

  // Controlled pilot mode: enabled with an empty allowlist means NOBODY,
  // never everybody.
  if (config.pilot.enabled && !config.pilot.allowlist.includes(input.salonSlug)) {
    return { ready: false, mode: 'shared_luster', reason: 'PILOT_NOT_ENABLED' };
  }

  if (
    config.messagingServiceSid === null
    || config.messagingServiceSid === ''
    || !config.accountSidPresent
    || !config.authTokenPresent
  ) {
    return { ready: false, mode: 'shared_luster', reason: 'SENDER_NOT_READY' };
  }

  if (config.creditReservation === null) {
    return { ready: false, mode: 'shared_luster', reason: 'SENDER_NOT_READY' };
  }

  return {
    ready: true,
    mode: 'shared_luster',
    messagingServiceSid: config.messagingServiceSid,
    senderIdentity: config.senderIdentity,
  };
}

export type ByoSenderResolution =
  | {
    ready: true;
    mode: 'connected_byo';
    connectAccountSid: string;
    messagingServiceSid: string | null;
    phoneNumber: string | null;
  }
  | { ready: false; mode: 'connected_byo'; reason: 'SENDER_NOT_READY' };

/** Retired accounts remain readable but can never become a sending capability. */
export function resolveByoSenderReadiness(
  _connection: TwilioConnectionSnapshot,
  _deps: { authTokenPresent: boolean },
): ByoSenderResolution {
  return { ready: false, mode: 'connected_byo', reason: 'SENDER_NOT_READY' };
}

/**
 * The one Env-reading seam. Platform-control and credit inputs are NOT
 * env-derived — they arrive from their owning modules in Gate B and stay
 * absent (fail-closed) until then.
 */
export type SharedSenderEnvSource = Pick<
  typeof Env,
  | 'COMMUNICATIONS_SMS_ENABLED'
  | 'TWILIO_MESSAGING_SERVICE_SID'
  | 'TWILIO_ACCOUNT_SID'
  | 'TWILIO_AUTH_TOKEN'
  | 'LUSTER_SMS_SENDER_IDENTITY'
  | 'SMS_PILOT_ENABLED'
  | 'SMS_PILOT_SALON_ALLOWLIST'
>;

export function readSharedSenderEnvConfig(
  env: SharedSenderEnvSource = Env,
): Omit<SharedSenderRuntimeConfig, 'platformControl' | 'creditReservation'> {
  const allowlist = (env.SMS_PILOT_SALON_ALLOWLIST ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  // Truthiness (not ??) on purpose: an EMPTY-STRING env value must fall back
  // to the default — this identity keys global STOP suppression, and '' would
  // silently orphan every existing opt-out.
  const senderIdentity = env.LUSTER_SMS_SENDER_IDENTITY || LUSTER_DEFAULT_SENDER_IDENTITY;
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID || null;
  return {
    communicationsSmsEnabled: env.COMMUNICATIONS_SMS_ENABLED === 'true',
    messagingServiceSid,
    accountSidPresent: Boolean(env.TWILIO_ACCOUNT_SID),
    authTokenPresent: Boolean(env.TWILIO_AUTH_TOKEN),
    senderIdentity,
    pilot: {
      enabled: env.SMS_PILOT_ENABLED === 'true',
      allowlist,
    },
  };
}
