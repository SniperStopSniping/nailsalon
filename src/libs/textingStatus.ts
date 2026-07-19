/**
 * Honest texting-status resolution, shared by the Integrations and Marketing
 * surfaces so both report identical channel truth. Manual texting works with
 * zero setup (native Messages app); automatic texting is only "Ready" when a
 * Twilio number is provisioned AND the SMS module is enabled.
 */

export type StatusTone = 'good' | 'warn' | 'muted' | 'error';

export type TextingHealth = {
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
  smsModuleReason: ModuleReason | null,
): AutomaticTextStatus {
  // A missing or malformed health payload must never claim any status.
  if (!health || !health.twilio || !health.availability) {
    return { label: 'Loading…', tone: 'muted', detail: '' };
  }
  const { twilio, availability } = health;
  if (twilio.status === 'active' && twilio.phoneNumber) {
    if (smsModuleReason === 'ENABLED') {
      return {
        label: 'Ready',
        tone: 'good',
        detail: `Automatic texts send from ${twilio.phoneNumber}.`,
      };
    }
    return {
      label: 'Setup incomplete',
      tone: 'warn',
      detail:
        smsModuleReason === 'MODULE_DISABLED'
          ? 'A number is connected, but SMS reminders are turned off in Settings.'
          : 'A number is connected, but SMS reminders are not included in this salon’s plan.',
    };
  }
  if (twilio.status === 'pending') {
    return {
      label: 'Setup incomplete',
      tone: 'warn',
      detail: 'Twilio is authorized. Choose a phone number to finish setup.',
    };
  }
  if (twilio.status === 'deauthorized' || twilio.lastError) {
    return {
      label: 'Error',
      tone: 'error',
      detail: twilio.lastError || 'The Twilio connection was removed. Reconnect to resume automatic texts.',
    };
  }
  if (!availability.twilio) {
    return {
      label: 'Not available yet',
      tone: 'muted',
      detail: 'Automatic texting is not offered on this Luster environment yet.',
    };
  }
  return {
    label: 'Not connected',
    tone: 'muted',
    detail: 'Optional. Connect Twilio to send reminders automatically.',
  };
}
