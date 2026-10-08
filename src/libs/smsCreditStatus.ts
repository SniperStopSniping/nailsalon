/** Shared owner UI/email policy. Change thresholds here, never in consumers. */
export const SMS_CREDIT_THRESHOLDS = Object.freeze({ low: 25, critical: 10 });

export type SmsCreditStatus = 'healthy' | 'low' | 'critical' | 'empty';

export function smsCreditStatus(remaining: number): SmsCreditStatus {
  if (remaining <= 0) {
    return 'empty';
  }
  if (remaining <= SMS_CREDIT_THRESHOLDS.critical) {
    return 'critical';
  }
  if (remaining <= SMS_CREDIT_THRESHOLDS.low) {
    return 'low';
  }
  return 'healthy';
}

export const SMS_CREDIT_STATUS_COPY: Record<SmsCreditStatus, { title: string; detail: string }> = {
  healthy: { title: 'You’re all set.', detail: '' },
  low: { title: 'Running low', detail: 'Add more texts to keep reminders and client follow-ups going.' },
  critical: { title: 'Almost out', detail: 'Top up now so your next reminders have the credits they need.' },
  empty: { title: 'Out of texts', detail: 'Add credits to send SMS messages. Online booking, email and your core app remain available.' },
};

export const SMS_CREDITS_CHANGED_EVENT = 'luster:sms-credits-changed';
