/**
 * SMS Notification Module
 *
 * Sends SMS notifications via Twilio for:
 * - Booking confirmations to clients
 * - New booking notifications to technicians
 * - Appointment reminders
 * - Cancellation confirmations
 *
 * Appointment operations enqueue durable communication intents. Legacy ancillary
 * sends fail closed; salon-owned Twilio sending is retired.
 * All SMS functions check the salon's smsRemindersEnabled toggle before sending.
 */

import { and, eq } from 'drizzle-orm';

import { bookingEmailTaxLineLabel } from '@/libs/bookingEmailFinancialPresentation';
import type { BookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { isAppointmentSmsEligible } from '@/libs/bookingSmsConsent.server';
import { db } from '@/libs/DB';
import { formatMoney } from '@/libs/formatMoney';
import { buildSalonPublicUrl } from '@/libs/publicUrl';
import { formatRewardDollars, REFERRAL_REFEREE_AMOUNT_CENTS } from '@/libs/rewardRules';
import { isSmsEnabled } from '@/libs/salonStatus';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { appointmentSchema } from '@/models/Schema';

// =============================================================================
// TYPES
// =============================================================================

export type BookingConfirmationParams = {
  phone: string;
  clientName?: string;
  appointmentId: string;
  salonName: string;
  services: string[];
  technicianName: string;
  startTime: string;
  financialSummary: BookingEmailFinancialSummary | null;
  timeZone?: string | null;
  manageUrl?: string;
};

export type SmsSendOptions = {
  signal?: AbortSignal;
};

export type TechNotificationParams = {
  technicianId: string;
  technicianName: string;
  technicianPhone?: string | null;
  appointmentId: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  startTime: string;
  totalDurationMinutes: number;
  financialSummary: BookingEmailFinancialSummary | null;
  timeZone?: string | null;
};

export type InternalBookingNotificationSmsParams = {
  appointmentId?: string;
  recipientAudience?: 'owner' | 'technician';
  phone: string;
  salonName: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  startTime: string;
  totalDurationMinutes: number;
  financialSummary: BookingEmailFinancialSummary | null;
  technicianName?: string | null;
  timeZone?: string | null;
};

export type InternalCancellationNotificationSmsParams = {
  appointmentId?: string;
  recipientAudience?: 'owner' | 'technician';
  phone: string;
  salonName: string;
  clientName: string;
  clientPhone?: string | null;
  services: string[];
  startTime: string;
  cancelReason: string;
  technicianName?: string | null;
  timeZone?: string | null;
};

export type ReminderParams = {
  phone: string;
  clientName?: string;
  appointmentId: string;
  salonName: string;
  startTime: string;
  hoursUntil: number;
  kind?: 'generic' | 'day_before' | 'same_day' | 'manual';
  services?: string[];
  technicianName?: string | null;
  timeZone?: string;
  manageUrl?: string | null;
};

export type SmartAppointmentReminderReason =
  | 'INVALID_PHONE'
  | 'SMS_DISABLED'
  | 'SMS_CONSENT_REQUIRED'
  | 'TWILIO_UNAVAILABLE';

export type SmartAppointmentReminderResult =
  | {
    outcome: 'sent' | 'duplicate';
    phone: string;
    body: string;
    sentAt: string;
  }
  | {
    outcome: 'manual';
    phone: string;
    body: string;
    reason: SmartAppointmentReminderReason;
  }
  | {
    outcome: 'provider_failure';
    phone: string;
    body: string;
    errorCode: string | null;
  };

export type ReferralInviteParams = {
  refereePhone: string;
  referrerName: string;
  salonName: string;
  salonCustomDomain?: string | null;
  referralId: string;
};

export type StaffInviteParams = {
  phone: string;
  techName: string;
  salonName: string;
  salonSlug: string;
};

function formatAppointmentRange(
  startTime: string,
  durationMinutes: number,
  timeZone?: string | null,
): string {
  const startDate = new Date(startTime);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  const formattedDate = formatDateInTimeZone(startTime, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }, timeZone);
  const formattedStartTime = formatTimeInTimeZone(startTime, {}, timeZone);
  const formattedEndTime = formatTimeInTimeZone(endDate.toISOString(), {}, timeZone);

  return `${formattedDate}, ${formattedStartTime}-${formattedEndTime}`;
}

function formatSmsMoney(cents: number, currency: string): string {
  return `${formatMoney(cents, currency)} ${currency}`;
}

/**
 * Project the canonical booking financial summary into compact SMS lines.
 * Null is a deliberate fail-closed state: callers must never reconstruct a
 * charge from mutable salon settings or the appointment's legacy raw total.
 */
export function buildBookingFinancialSmsLines(
  summary: BookingEmailFinancialSummary | null,
): string[] {
  if (!summary || summary.depositBlockedCode) {
    return [
      'Payment details: under review',
      'Your final payment amount will be confirmed before collection.',
    ];
  }

  const taxLineLabel = bookingEmailTaxLineLabel(summary);
  const lines = taxLineLabel
    ? [`${taxLineLabel}: ${formatSmsMoney(summary.taxAmountCents!, summary.currency)}`]
    : [];
  lines.push(
    `${summary.taxClassification === 'actual' ? 'Invoice total' : 'Estimated appointment total'}: ${formatSmsMoney(summary.totalDueCents, summary.currency)}`,
  );
  if (summary.collectedDepositCents > 0) {
    lines.push(`Deposit paid: ${formatSmsMoney(summary.collectedDepositCents, summary.currency)}`);
  }
  if (summary.refundedDepositCents > 0) {
    lines.push(`Deposit refunded: ${formatSmsMoney(summary.refundedDepositCents, summary.currency)}`);
  }
  if (summary.forfeitedDepositCents > 0) {
    lines.push(`Deposit retained: ${formatSmsMoney(summary.forfeitedDepositCents, summary.currency)}`);
  }
  if (summary.depositCreditAppliedCents > 0) {
    lines.push(`Deposit applied: -${formatSmsMoney(summary.depositCreditAppliedCents, summary.currency)}`);
  }
  if (summary.appointmentPaymentsCents > 0) {
    lines.push(`Other payments: ${formatSmsMoney(summary.appointmentPaymentsCents, summary.currency)}`);
  }
  lines.push(
    `Already paid: ${formatSmsMoney(summary.amountAlreadyPaidCents, summary.currency)}`,
    `${summary.taxClassification === 'actual' ? 'Balance due' : 'Estimated remaining balance'}: ${formatSmsMoney(summary.balanceCents, summary.currency)}`,
  );
  return lines;
}

// =============================================================================
// TWILIO CLIENT
// =============================================================================

/**
 * Legacy reminder facade returns an explicit native-phone draft. Actual Luster
 * sends use the canonical communication dispatcher and its credit reservation.
 */
export async function sendSmartAppointmentReminder(
  salonId: string,
  params: ReminderParams & { force?: boolean; now?: Date },
): Promise<SmartAppointmentReminderResult> {
  const body = buildAppointmentReminderMessage({ ...params, kind: 'manual' });
  const normalizedPhone = normalizeSmsRecipient(params.phone);
  const fallbackPhone = normalizedPhone ?? params.phone.trim();

  if (!normalizedPhone) {
    return {
      outcome: 'manual',
      phone: fallbackPhone,
      body,
      reason: 'INVALID_PHONE',
    };
  }

  if (!await isSmsEnabled(salonId)) {
    return {
      outcome: 'manual',
      phone: normalizedPhone,
      body,
      reason: 'SMS_DISABLED',
    };
  }

  if (!await isAppointmentSmsEligible({ salonId, phone: normalizedPhone, appointmentId: params.appointmentId })) {
    return {
      outcome: 'manual',
      phone: normalizedPhone,
      body,
      reason: 'SMS_CONSENT_REQUIRED',
    };
  }

  return { outcome: 'manual', phone: normalizedPhone, body, reason: 'TWILIO_UNAVAILABLE' };
}

function normalizeSmsRecipient(phone: string): string | null {
  const digits = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length === 10 ? digits : null;
}

type SmsDeliveryContext = {
  appointmentId?: string;
  purpose?: string;
  signal?: AbortSignal;
};

function throwIfSmsAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('SMS_DELIVERY_ABORTED');
}

async function sendSMS(
  _salonId: string,
  _to: string,
  _body: string,
  context: SmsDeliveryContext = {},
): Promise<boolean> {
  throwIfSmsAborted(context.signal);
  // Compatibility facade for retired BYO texting. Never send without the ledger.
  return false;
}

// =============================================================================
// SMS FUNCTIONS
// =============================================================================

/**
 * Send booking confirmation SMS to the client
 */
export async function sendBookingConfirmationToClient(
  salonId: string,
  params: BookingConfirmationParams,
  options: SmsSendOptions = {},
): Promise<void> {
  throwIfSmsAborted(options.signal);
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }
  throwIfSmsAborted(options.signal);

  const {
    phone,
    clientName,
    salonName,
    services,
    technicianName,
    startTime,
    financialSummary,
    timeZone,
  } = params;

  const appointmentRange = formatAppointmentRange(startTime, 0, timeZone).replace(/-.+$/, '');

  if (!await isAppointmentSmsEligible({ salonId, phone, appointmentId: params.appointmentId })) {
    console.warn('[SMS CONSENT MISSING] Booking confirmation skipped:', salonId);
    return;
  }
  throwIfSmsAborted(options.signal);

  const message = `${salonName}
Appointment confirmed

Hi ${clientName || 'there'},

${services.join(' + ')} with ${technicianName}
${appointmentRange}
${buildBookingFinancialSmsLines(financialSummary).join('\n')}

${params.manageUrl ? `Manage: ${params.manageUrl}\n` : ''}Reply STOP to opt out. Reply to this text if you need help.`;

  await sendSMS(salonId, phone, message, {
    appointmentId: params.appointmentId,
    purpose: 'booking_confirmation',
    signal: options.signal,
  });
}

/**
 * Send notification SMS to the technician about a new booking
 */
export async function sendBookingNotificationToTech(
  salonId: string,
  params: TechNotificationParams,
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const {
    technicianName,
    technicianPhone,
    clientName,
    clientPhone,
    services,
    startTime,
    totalDurationMinutes,
    financialSummary,
  } = params;

  if (!technicianPhone) {
    console.warn('[SMS SKIPPED] Technician phone missing for booking notification:', {
      salonId,
      technicianId: params.technicianId,
      technicianName,
    });
    return;
  }

  await sendInternalBookingNotificationSms(salonId, {
    appointmentId: params.appointmentId,
    recipientAudience: 'technician',
    phone: technicianPhone,
    salonName: '',
    clientName,
    clientPhone,
    services,
    startTime,
    totalDurationMinutes,
    financialSummary,
    technicianName,
    timeZone: params.timeZone,
  });
}

/** Internal alerts use the same queue, history, credits and sender as client messages. */
async function enqueueInternalSms(
  salonId: string,
  params: InternalBookingNotificationSmsParams | InternalCancellationNotificationSmsParams,
  cancelled: boolean,
): Promise<boolean> {
  if (!params.appointmentId || !normalizeSmsRecipient(params.phone)) {
    return false;
  }
  const { enqueueCommunicationIntent } = await import('@/libs/communicationIntent');
  const { formatIntentStartTime, resolveSalonCommunicationContext } = await import('@/libs/communicationMaterialization');
  const { resolveEventChannels } = await import('@/libs/communicationSettings');
  const context = await resolveSalonCommunicationContext(db, salonId);
  const audience = params.recipientAudience ?? 'owner';
  const eventType = audience === 'technician'
    ? cancelled ? 'tech_appointment_cancelled' : 'tech_new_booking'
    : cancelled ? 'owner_appointment_cancelled' : 'owner_new_booking';
  if (!context.smsEligible || !resolveEventChannels(context.settings, eventType).includes('sms')) {
    return false;
  }
  const [appointment] = await db.select({ updatedAt: appointmentSchema.updatedAt, status: appointmentSchema.status, confirmationModeSnapshot: appointmentSchema.confirmationModeSnapshot })
    .from(appointmentSchema).where(and(eq(appointmentSchema.id, params.appointmentId), eq(appointmentSchema.salonId, salonId))).limit(1);
  if (!appointment) {
    return false;
  }
  const now = new Date();
  await enqueueCommunicationIntent({
    salonId,
    appointmentId: params.appointmentId,
    channel: 'sms',
    eventType,
    audience,
    dedupeKey: `internal:${salonId}:${params.appointmentId}:${eventType}:${normalizeSmsRecipient(params.phone)}:${cancelled ? appointment.updatedAt.toISOString() : 'created'}`,
    recipient: params.phone,
    destinationCountry: 'CA',
    templateKey: cancelled ? 'owner_appointment_cancelled' : 'owner_new_booking',
    templateVersion: 'v1',
    variables: {
      clientName: params.clientName,
      serviceName: params.services.join(', '),
      startTime: formatIntentStartTime(new Date(params.startTime), context.timeZone),
      statusLabel: cancelled
        ? 'cancelReason' in params && params.cancelReason === 'no_show' ? 'No-show' : 'Cancelled'
        : appointment.status === 'pending' ? 'New booking request' : 'New booking',
    },
    schedulingRevision: appointment.updatedAt.toISOString(),
    scheduledFor: now,
    notAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
  return true;
}

export async function sendInternalBookingNotificationSms(
  salonId: string,
  params: InternalBookingNotificationSmsParams,
  options: SmsSendOptions = {},
): Promise<boolean> {
  throwIfSmsAborted(options.signal);
  return enqueueInternalSms(salonId, params, false);
}

export async function sendInternalCancellationNotificationSms(
  salonId: string,
  params: InternalCancellationNotificationSmsParams,
): Promise<boolean> {
  return enqueueInternalSms(salonId, params, true);
}

/**
 * Send appointment reminder SMS to the client
 */
export function buildAppointmentReminderMessage(params: ReminderParams): string {
  const {
    clientName,
    salonName,
    startTime,
    hoursUntil,
    kind = 'generic',
    services = [],
    technicianName = null,
    timeZone,
    manageUrl,
  } = params;

  const date = new Date(startTime);
  const formattedTime = date.toLocaleTimeString('en-US', {
    ...(timeZone ? { timeZone } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const formattedDate = date.toLocaleDateString('en-US', {
    ...(timeZone ? { timeZone } : {}),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const timeUntilText = hoursUntil >= 24
    ? 'tomorrow'
    : `in ${hoursUntil} hours`;
  const manageLine = manageUrl
    ? `View, reschedule, or cancel: ${manageUrl}`
    : null;

  if (kind === 'day_before') {
    return [
      `Hi ${clientName || 'there'}!`,
      '',
      `Reminder: Your appointment at ${salonName} is tomorrow at ${formattedTime}.`,
      ...(services.length > 0 ? [`Service: ${services.join(', ')}`] : []),
      ...(technicianName ? [`Artist: ${technicianName}`] : []),
      ...(manageLine ? [manageLine] : ['Need to reschedule? Reply or call us.']),
    ].join('\n');
  }

  if (kind === 'same_day') {
    return [
      `Hi ${clientName || 'there'}!`,
      '',
      `Your appointment at ${salonName} is today at ${formattedTime}.`,
      ...(services.length > 0 ? [`Service: ${services.join(', ')}`] : []),
      ...(technicianName ? [`Artist: ${technicianName}`] : []),
      `See you soon on ${formattedDate}.`,
      ...(manageLine ? [manageLine] : []),
    ].join('\n');
  }

  if (kind === 'manual') {
    return [
      `Hi ${clientName || 'there'}!`,
      '',
      `Reminder: Your appointment at ${salonName} is on ${formattedDate} at ${formattedTime}.`,
      ...(services.length > 0 ? [`Service: ${services.join(', ')}`] : []),
      ...(technicianName ? [`Artist: ${technicianName}`] : []),
      ...(manageLine ? ['', manageLine] : []),
      '',
      'Reply STOP to opt out. Reply to this text if you need help.',
    ].join('\n');
  }

  return [
    `Hi ${clientName || 'there'},`,
    '',
    `Reminder: Your appointment at ${salonName} is ${timeUntilText} at ${formattedTime}.`,
    ...(manageLine ? ['', manageLine] : []),
    '',
    'Need to reschedule? Reply or call us.',
  ].join('\n');
}

export async function sendAppointmentReminder(
  salonId: string,
  params: ReminderParams,
): Promise<boolean> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return false;
  }
  if (!await isAppointmentSmsEligible({ salonId, phone: params.phone, appointmentId: params.appointmentId })) {
    console.warn('[SMS CONSENT MISSING] Appointment reminder skipped:', salonId);
    return false;
  }

  return sendSMS(salonId, params.phone, buildAppointmentReminderMessage(params), {
    appointmentId: params.appointmentId,
    purpose: params.kind === 'day_before'
      ? 'appointment_reminder_24h'
      : params.kind === 'same_day'
        ? 'appointment_reminder_2h'
        : 'appointment_reminder',
  });
}

/**
 * Send cancellation confirmation to client
 */
export async function sendCancellationConfirmation(
  salonId: string,
  params: {
    phone: string;
    clientName?: string;
    appointmentId: string;
    salonName: string;
  },
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }
  if (!await isAppointmentSmsEligible({ salonId, phone: params.phone, appointmentId: params.appointmentId })) {
    return;
  }

  const { phone, clientName, salonName } = params;

  const message = `Hi ${clientName || 'there'},

Your appointment at ${salonName} has been cancelled.

We hope to see you again soon.
Book anytime at our website.`;

  await sendSMS(salonId, phone, message, { appointmentId: params.appointmentId, purpose: 'cancellation_confirmation' });
}

/**
 * Send reschedule confirmation SMS to the client
 */
export async function sendRescheduleConfirmation(
  salonId: string,
  params: {
    phone: string;
    clientName?: string;
    appointmentId: string;
    salonName: string;
    oldStartTime: string;
    newStartTime: string;
    services: string[];
    technicianName: string;
    timeZone?: string | null;
  },
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }
  if (!await isAppointmentSmsEligible({ salonId, phone: params.phone, appointmentId: params.appointmentId })) {
    return;
  }

  const { phone, clientName, salonName, oldStartTime, newStartTime, services, technicianName, timeZone } = params;

  const oldFormattedDate = formatDateInTimeZone(oldStartTime, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }, timeZone);
  const oldFormattedTime = formatTimeInTimeZone(oldStartTime, {}, timeZone);

  const newFormattedDate = formatDateInTimeZone(newStartTime, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }, timeZone);
  const newFormattedTime = formatTimeInTimeZone(newStartTime, {}, timeZone);

  const message = `${salonName}
Appointment rescheduled

Hi ${clientName || 'there'},

Old: ${oldFormattedDate} at ${oldFormattedTime}
New: ${newFormattedDate} at ${newFormattedTime}

${services.join(' + ')} with ${technicianName}

Reply to this text if you need help.`;

  await sendSMS(salonId, phone, message, { appointmentId: params.appointmentId, purpose: 'reschedule_confirmation' });
}

/**
 * Send cancellation/reschedule notification to the technician
 */
export async function sendCancellationNotificationToTech(
  salonId: string,
  params: {
    technicianName: string;
    technicianPhone?: string;
    clientName: string;
    startTime: string;
    services: string[];
    cancelReason: 'cancelled' | 'rescheduled';
    timeZone?: string | null;
  },
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { technicianName, technicianPhone, clientName, startTime, services, cancelReason, timeZone } = params;

  const formattedDate = formatDateInTimeZone(startTime, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }, timeZone);
  const formattedTime = formatTimeInTimeZone(startTime, {}, timeZone);

  const actionText = cancelReason === 'rescheduled' ? 'rescheduled' : 'cancelled';

  if (technicianPhone) {
    await sendInternalCancellationNotificationSms(salonId, {
      phone: technicianPhone,
      salonName: '',
      clientName,
      clientPhone: null,
      services,
      startTime,
      cancelReason,
      technicianName,
      timeZone,
    });
  } else {
    const message = `Appointment ${actionText}

${technicianName}, an appointment has been ${actionText}:

Client: ${clientName}
Time: ${formattedDate} at ${formattedTime}
Service: ${services.join(', ')}`;

    void message;
  }
}

/**
 * Send referral invite SMS to a friend
 */
export async function sendReferralInvite(
  salonId: string,
  params: ReferralInviteParams,
): Promise<boolean> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return false;
  }

  const { refereePhone, referrerName, salonName, salonCustomDomain, referralId } = params;

  // Build the claim URL
  const claimUrl = buildSalonPublicUrl(`/referral/${referralId}`, {
    customDomain: salonCustomDomain,
  });

  const message = `${referrerName} sent you ${formatRewardDollars(REFERRAL_REFEREE_AMOUNT_CENTS)} off your first appointment at ${salonName}.

Claim your gift:
${claimUrl}

Book within 14 days to use your reward.`;

  return sendSMS(salonId, refereePhone, message);
}

/**
 * Send staff invite SMS to a new technician
 * Invites them to log in to the staff dashboard
 */
export async function sendStaffInvite(
  salonId: string,
  params: StaffInviteParams,
): Promise<boolean> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return false;
  }

  const { phone, techName, salonName, salonSlug } = params;

  // Build the login URL with phone and salon prefilled
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'http://localhost:3000';

  // URL-encode the phone number
  const encodedPhone = encodeURIComponent(phone);
  // Use /en/ locale prefix for staff login URL
  const loginUrl = `${baseUrl}/en/staff-login?salon=${salonSlug}&phone=${encodedPhone}`;

  const message = `👋 Hi ${techName}!

You've been added as staff at ${salonName}.

Tap to log in and access your dashboard:
${loginUrl}

💅 See your appointments, clients & more!`;

  return sendSMS(salonId, phone, message);
}
