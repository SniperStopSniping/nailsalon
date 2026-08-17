/**
 * Sender-mode resolution — Gate A foundation (MODE FIRST, then per-mode
 * validation).
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §9.4.
 *
 * Step 1 resolves the candidate mode from the salon's own state ALONE —
 * no environment variable can influence which mode a salon is in. Step 2
 * validates only that mode's provider configuration. This ordering is a
 * binding Rev 2.2 correction: the legacy resolver folded platform env
 * state into the BYO predicate and fell through to a different sender on
 * failure, which could silently reclassify a BYO salon onto the shared
 * number. Here, a failed validation returns a typed reason for the SAME
 * mode — there is no fall-through between modes, ever.
 *
 * Dark-by-default is structural: the shared path requires
 * COMMUNICATIONS_SMS_ENABLED === 'true' (unset = disabled), a platform
 * communication control row (Migration B — does not exist yet, so `null`
 * fails closed) and a credit-reservation capability (Migration A wiring —
 * also `null` in Gate A). Deploying this code sends nothing.
 *
 * Existing BYO continuity is env-independent: nothing in the
 * connected_byo path reads the shared Messaging Service, the pilot
 * allowlist, COMMUNICATIONS_SMS_ENABLED, credits or the global-STOP
 * namespace. New BYO ONBOARDING (a separate permission) is guarded in the
 * Twilio connect/provision routes, deliberately not here.
 *
 * This module never imports the Twilio SDK or the database, consults
 * neither the legacy free-solo salon flag nor the deprecated legacy
 * entitlement chain, and cannot originate a message. Tests enforce all of that by source
 * scan.
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
  | 'PLAN_NOT_ELIGIBLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'DESTINATION_NOT_SUPPORTED';

export type TwilioConnectionSnapshot = {
  status: string;
  connectAccountSid: string;
  messagingServiceSid: string | null;
  phoneNumber: string | null;
};

/**
 * Step 1 — candidate mode from salon state alone. `perSalonDisabled` is
 * deliberately required with no default: every caller must decide it
 * explicitly (Gate C wires settings.communications.killSwitch here).
 *
 * BYO predicate note (deliberate §9.4 reading, recorded in the Gate A
 * owner report): the contract text keys BYO on a messagingServiceSid, but
 * live production behavior accepts an active connection with EITHER a
 * Messaging Service or a bare phone number. A literal reading would
 * silently reclassify a phone-only active BYO salon onto the (dark)
 * shared sender and stop its texts — so continuity wins and the predicate
 * matches today's behavior exactly.
 */
export function resolveSmsSenderMode(input: {
  connection: TwilioConnectionSnapshot | null;
  perSalonDisabled: boolean;
}): SmsSenderMode {
  if (input.perSalonDisabled) {
    return 'disabled';
  }
  const connection = input.connection;
  if (
    connection !== null
    && connection.status === 'active'
    && (connection.messagingServiceSid !== null || connection.phoneNumber !== null)
  ) {
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
    reason: Extract<SmsUnavailableReason, 'GLOBAL_SMS_DISABLED' | 'SENDER_NOT_READY' | 'PLAN_NOT_ELIGIBLE'>;
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
  if (config.platformControl === null || config.platformControl.smsEnabled !== true) {
    return { ready: false, mode: 'shared_luster', reason: 'SENDER_NOT_READY' };
  }

  // Controlled pilot mode: enabled with an empty allowlist means NOBODY,
  // never everybody.
  if (config.pilot.enabled && !config.pilot.allowlist.includes(input.salonSlug)) {
    return { ready: false, mode: 'shared_luster', reason: 'PLAN_NOT_ELIGIBLE' };
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

/**
 * BYO validation reads ONLY the connection row and the master auth-token
 * presence. A missing auth token makes BYO unavailable in place — it
 * NEVER falls through to the shared sender.
 */
export function resolveByoSenderReadiness(
  connection: TwilioConnectionSnapshot,
  deps: { authTokenPresent: boolean },
): ByoSenderResolution {
  // Defense in depth for future callers: the mode resolver guarantees this
  // invariant, but nothing type-enforces call ordering.
  if (connection.messagingServiceSid === null && connection.phoneNumber === null) {
    return { ready: false, mode: 'connected_byo', reason: 'SENDER_NOT_READY' };
  }
  if (!deps.authTokenPresent) {
    return { ready: false, mode: 'connected_byo', reason: 'SENDER_NOT_READY' };
  }
  return {
    ready: true,
    mode: 'connected_byo',
    connectAccountSid: connection.connectAccountSid,
    messagingServiceSid: connection.messagingServiceSid,
    phoneNumber: connection.phoneNumber,
  };
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
