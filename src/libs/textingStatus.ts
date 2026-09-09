/**
 * Honest texting-status resolution, shared by the Integrations and Marketing
 * surfaces so both report identical channel truth. Server-resolved SMS health
 * includes sender readiness, salon preferences, worker configuration and credits.
 */

export type StatusTone = 'good' | 'warn' | 'muted' | 'error';

export type SmsOperationalHealth = {
  providerReady: boolean;
  senderMode: 'shared_luster' | 'connected_byo' | 'disabled';
  senderLabel: string;
  phoneNumber: string | null;
  blockingReason: string | null;
  detail: string;
  smsEnabled: boolean;
  automaticEnabled: boolean;
  manualAvailable: boolean;
  remindersEnabled: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  availableCredits: number | null;
  workerConfigured: boolean;
};

export type TextingHealth = {
  sms?: SmsOperationalHealth;
  availability: { twilio: boolean };
  twilio: {
    status: string;
    phoneNumber?: string | null;
    lastError?: string | null;
  };
};

export type ModuleReason = 'ENABLED' | 'MODULE_DISABLED' | 'UPGRADE_REQUIRED';

export type AutomaticTextStatus = {
  label:
    | 'Ready'
    | 'Paused'
    | 'Setup incomplete'
    | 'Not connected'
    | 'Error'
    | 'Not available yet'
    | 'Loading…';
  tone: StatusTone;
  detail: string;
};

/**
 * Manual texting opens the device's native Messages app via an sms: link.
 * That only makes sense on a phone or tablet; report the truth per device.
 */
export function isNativeSmsCapableDevice(userAgent: string): boolean {
  return /iphone|ipad|ipod|android/i.test(userAgent);
}

export function resolveAutomaticTextStatus(
  health: TextingHealth | null,
  _smsModuleReason: ModuleReason | null,
): AutomaticTextStatus {
  // A missing or malformed health payload must never claim any status.
  if (!health || !health.twilio || !health.availability) {
    return { label: 'Loading…', tone: 'muted', detail: '' };
  }
  if (health.sms?.senderMode === 'connected_byo' || (!health.sms && health.twilio.status !== 'disconnected')) {
    return {
      label: 'Setup incomplete',
      tone: 'warn',
      detail: 'This texting connection is retired. Luster texts use SMS credits. Contact support before enabling Luster texting.',
    };
  }
  if (health.sms) {
    if (health.sms.blockingReason === 'GLOBAL_SMS_DISABLED') {
      return { label: 'Paused', tone: 'warn', detail: health.sms.detail };
    }
    if (health.sms.blockingReason === 'PILOT_NOT_ENABLED') {
      return { label: 'Not available yet', tone: 'muted', detail: health.sms.detail };
    }
    return {
      label: health.sms.automaticEnabled ? 'Ready' : health.sms.providerReady ? 'Paused' : 'Setup incomplete',
      tone: health.sms.automaticEnabled ? 'good' : 'warn',
      detail: health.sms.detail,
    };
  }
  return {
    label: 'Not available yet',
    tone: 'muted',
    detail: 'Luster texting readiness could not be verified. Refresh or contact support.',
  };
}

export function resolveManualTextStatus(health: TextingHealth | null): AutomaticTextStatus {
  const status = resolveAutomaticTextStatus(health, null);
  if (!health?.sms || !health.twilio || !health.availability || health.sms.senderMode === 'connected_byo') {
    return status;
  }
  if (health.sms.manualAvailable) {
    return { label: 'Ready', tone: 'good', detail: health.sms.detail };
  }
  return status.label === 'Ready'
    ? { label: 'Paused', tone: 'warn', detail: health.sms.detail }
    : status;
}
