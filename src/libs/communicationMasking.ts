/**
 * Recipient masking + friendly failure taxonomy — Gate C4 (§10.4/§10.5).
 *
 * One tiny pure module shared by every owner-facing surface, so the masking
 * rules cannot drift between the API and the UI. Raw provider errors,
 * Auth Tokens and full recipients never reach ordinary owners; technical
 * detail belongs in operator tooling.
 */

/** Phone: last four only — '•••• 0199'. Anything unparseable masks fully. */
export function maskPhone(recipient: string | null | undefined): string {
  const digits = (recipient ?? '').replace(/\D/g, '');
  if (digits.length < 4) {
    return '••••';
  }
  return `•••• ${digits.slice(-4)}`;
}

/** Email: first character + domain — 'c•••@example.com'. */
export function maskEmail(recipient: string | null | undefined): string {
  const value = (recipient ?? '').trim();
  const at = value.indexOf('@');
  if (at < 1) {
    return '••••';
  }
  return `${value[0]}•••@${value.slice(at + 1)}`;
}

export function maskRecipient(channel: string, recipient: string | null | undefined): string {
  return channel === 'email' ? maskEmail(recipient) : maskPhone(recipient);
}

/**
 * Bounded, allowlisted failure copy (§10.5). UNKNOWN internal codes map to
 * one generic line — never echoed through, so a provider message can never
 * leak into a salon's UI.
 */
const FRIENDLY_FAILURES: Record<string, string> = {
  NOT_AFTER_ELAPSED: 'This message expired before it was useful.',
  QUIET_HOURS_STALE: 'This message expired before quiet hours ended.',
  APPOINTMENT_SUPERSEDED: 'The appointment changed, so this message was replaced.',
  APPOINTMENT_NO_LONGER_ACTIVE: 'The appointment was cancelled.',
  SCHEDULING_REVISION_SUPERSEDED: 'Settings changed, so this message was rescheduled.',
  REMINDER_RULE_CHANGED: 'Reminder settings changed, so this message was cancelled.',
  SALON_INACTIVE: 'Texting is unavailable while this salon is inactive.',
  GLOBAL_SMS_DISABLED: 'Text delivery is temporarily paused. Contact support.',
  NO_CREDITS: 'SMS credits were unavailable.',
  BLOCKED_NO_CREDIT: 'SMS credits were unavailable.',
  GLOBAL_OPT_OUT: 'This person has opted out of texts.',
  CONSENT_REQUIRED: 'This person has not agreed to receive texts.',
  DESTINATION_NOT_SUPPORTED: 'Texts to this number are not supported yet.',
  RATE_LIMITED: 'Sending was briefly paused; the message expired.',
  SENDER_NOT_READY: 'Texting is not set up yet.',
  EMAIL_LANE_NOT_WIRED: 'Email sending is not set up yet.',
  WORKER_LEASE_EXPIRED: 'Sending was interrupted and retried.',
  WORKER_DIED_MID_SEND: 'The delivery result is being confirmed.',
  PROVIDER_OUTCOME_UNKNOWN: 'The delivery result is being confirmed. This text will not be resent automatically.',
  PROVIDER_SYNC_REJECT: 'The texting provider rejected this message. Check the texting setup, then retry.',
  RECIPIENT_CHANGED: 'The client contact number changed. Review their contact details before sending a new text.',
  SMS_DISABLED: 'Text messages are turned off in Settings.',
  COMMUNICATIONS_PAUSED: 'Communications are paused in Settings.',
  QUIET_HOURS: 'Queued until quiet hours end.',
  WORKER_NOT_CONFIGURED: 'Text delivery is not configured. Contact support.',
};

export function friendlyFailureReason(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return FRIENDLY_FAILURES[code] ?? FRIENDLY_FAILURES[code.split(':').at(-1) ?? '']
    ?? FRIENDLY_FAILURES[code.split(':')[0] ?? ''] ?? 'This message could not be delivered.';
}
