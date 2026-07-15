/**
 * SMS Notification Module
 *
 * Sends SMS notifications via Twilio for:
 * - Booking confirmations to clients
 * - New booking notifications to technicians
 * - Appointment reminders
 * - Cancellation confirmations
 *
 * Falls back to console logging in dev mode if Twilio is not configured.
 * All SMS functions check the salon's smsRemindersEnabled toggle before sending.
 */

import { and, desc, eq } from 'drizzle-orm';
import twilio from 'twilio';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { buildSalonPublicUrl } from '@/libs/publicUrl';
import { formatRewardDollars, REFERRAL_REFEREE_AMOUNT_CENTS } from '@/libs/rewardRules';
import { isSmsEnabled } from '@/libs/salonStatus';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { communicationConsentSchema, notificationDeliverySchema, salonSchema, salonTwilioConnectionSchema } from '@/models/Schema';

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
  totalPrice: number;
  timeZone?: string | null;
  manageUrl?: string;
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
  totalPrice?: number;
  timeZone?: string | null;
};

export type InternalBookingNotificationSmsParams = {
  phone: string;
  salonName: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  startTime: string;
  totalDurationMinutes: number;
  totalPrice: number;
  technicianName?: string | null;
  timeZone?: string | null;
};

export type InternalCancellationNotificationSmsParams = {
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
  kind?: 'generic' | 'day_before' | 'same_day';
  services?: string[];
  technicianName?: string | null;
  timeZone?: string;
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

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

// =============================================================================
// TWILIO CLIENT
// =============================================================================

function getLegacyTwilioClient() {
  if (!Env.TWILIO_ACCOUNT_SID || !Env.TWILIO_AUTH_TOKEN || !Env.TWILIO_PHONE_NUMBER) {
    return null;
  }
  return twilio(Env.TWILIO_ACCOUNT_SID, Env.TWILIO_AUTH_TOKEN);
}

/**
 * Send an SMS message via Twilio
 * Falls back to console logging if Twilio is not configured
 */
async function getSalonTwilioSender(salonId: string) {
  const [connection] = await db
    .select()
    .from(salonTwilioConnectionSchema)
    .where(and(eq(salonTwilioConnectionSchema.salonId, salonId), eq(salonTwilioConnectionSchema.status, 'active')))
    .limit(1);
  if (connection && Env.TWILIO_AUTH_TOKEN && (connection.messagingServiceSid || connection.phoneNumber)) {
    return {
      client: twilio(connection.connectAccountSid, Env.TWILIO_AUTH_TOKEN),
      messagingServiceSid: connection.messagingServiceSid,
      phoneNumber: connection.phoneNumber,
    };
  }
  const [salon] = await db.select({ freeSoloEnabled: salonSchema.freeSoloEnabled }).from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
  if (salon?.freeSoloEnabled) {
    return null;
  }
  const legacyClient = getLegacyTwilioClient();
  return legacyClient ? { client: legacyClient, messagingServiceSid: null, phoneNumber: Env.TWILIO_PHONE_NUMBER ?? null } : null;
}

async function hasTransactionalSmsConsent(salonId: string, phone: string): Promise<boolean> {
  const normalized = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const [consent] = await db
    .select({ status: communicationConsentSchema.status })
    .from(communicationConsentSchema)
    .where(and(
      eq(communicationConsentSchema.salonId, salonId),
      eq(communicationConsentSchema.recipient, normalized),
      eq(communicationConsentSchema.channel, 'sms'),
      eq(communicationConsentSchema.purpose, 'appointment_transactional'),
    ))
    .orderBy(desc(communicationConsentSchema.createdAt))
    .limit(1);
  return consent?.status === 'granted';
}

type SmsDeliveryContext = {
  appointmentId?: string;
  purpose?: string;
};

async function sendSMS(
  salonId: string,
  to: string,
  body: string,
  context: SmsDeliveryContext = {},
): Promise<boolean> {
  const deliveryId = crypto.randomUUID();
  await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId,
    appointmentId: context.appointmentId || null,
    channel: 'sms',
    purpose: context.purpose || 'transactional',
    dedupeKey: `sms:${deliveryId}`,
    status: 'queued',
  }).catch(() => undefined);
  const sender = await getSalonTwilioSender(salonId);

  if (!sender) {
    console.warn('[SMS DEV MODE] Would send to:', to);
    console.warn('[SMS DEV MODE] Message:', body);
    console.warn('---');
    await db.update(notificationDeliverySchema).set({ status: 'failed', errorCode: 'SENDER_UNAVAILABLE', errorMessage: 'No active salon Twilio sender', retryable: true }).where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, salonId))).catch(() => undefined);
    return false;
  }

  try {
    const normalizedTo = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
    const statusCallback = Env.NEXT_PUBLIC_APP_URL
      ? `${Env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/integrations/twilio/status?deliveryId=${encodeURIComponent(deliveryId)}`
      : null;
    const message = await sender.client.messages.create({
      body,
      ...(sender.messagingServiceSid
        ? { messagingServiceSid: sender.messagingServiceSid }
        : { from: sender.phoneNumber! }),
      ...(statusCallback ? { statusCallback } : {}),
      to: normalizedTo,
    });
    console.warn('SMS sent successfully:', message.sid);
    await db.update(notificationDeliverySchema).set({ status: message.status || 'accepted', providerMessageId: message.sid }).where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, salonId))).catch(() => undefined);
    return true;
  } catch (error) {
    console.error('Failed to send SMS:', error);
    const providerError = error as { code?: number | string; status?: number };
    const errorCode = providerError.code ? String(providerError.code) : null;
    const retryable = (providerError.status ?? 0) >= 500 || ['30001', '30008'].includes(errorCode || '');
    await db.update(notificationDeliverySchema).set({ status: 'failed', errorCode, errorMessage: error instanceof Error ? error.message : String(error), retryable }).where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, salonId))).catch(() => undefined);
    // Don't throw - we don't want SMS failures to break bookings
    return false;
  }
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
): Promise<void> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return;
  }

  const { phone, clientName, salonName, services, technicianName, startTime, totalPrice, timeZone } = params;

  const appointmentRange = formatAppointmentRange(startTime, 0, timeZone).replace(/-.+$/, '');

  if (!await hasTransactionalSmsConsent(salonId, phone)) {
    console.warn('[SMS CONSENT MISSING] Booking confirmation skipped:', salonId);
    return;
  }

  const message = `${salonName}
Appointment confirmed

Hi ${clientName || 'there'},

${services.join(' + ')} with ${technicianName}
${appointmentRange}
Total: ${formatPrice(totalPrice)}

${params.manageUrl ? `Manage: ${params.manageUrl}\n` : ''}Reply STOP to opt out. Reply to this text if you need help.`;

  await sendSMS(salonId, phone, message, { appointmentId: params.appointmentId, purpose: 'booking_confirmation' });
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

  const { technicianName, technicianPhone, clientName, clientPhone, services, startTime, totalDurationMinutes, totalPrice = 0 } = params;

  if (!technicianPhone) {
    console.warn('[SMS SKIPPED] Technician phone missing for booking notification:', {
      salonId,
      technicianId: params.technicianId,
      technicianName,
    });
    return;
  }

  await sendInternalBookingNotificationSms(salonId, {
    phone: technicianPhone,
    salonName: '',
    clientName,
    clientPhone,
    services,
    startTime,
    totalDurationMinutes,
    totalPrice,
    technicianName,
    timeZone: params.timeZone,
  });
}

export async function sendInternalBookingNotificationSms(
  salonId: string,
  params: InternalBookingNotificationSmsParams,
): Promise<boolean> {
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return false;
  }

  const {
    phone,
    salonName,
    clientName,
    clientPhone,
    services,
    startTime,
    totalDurationMinutes,
    totalPrice,
    technicianName,
    timeZone,
  } = params;

  const appointmentRange = formatAppointmentRange(startTime, totalDurationMinutes, timeZone);
  const serviceLabel = services.join(', ');

  const messageLines = [
    `New booking${salonName ? ` at ${salonName}` : ''}`,
    '',
    technicianName ? `${serviceLabel} with ${technicianName}` : serviceLabel,
    appointmentRange,
    '',
    `Client: ${clientName}`,
    `Phone: ${clientPhone}`,
    `Duration: ${totalDurationMinutes} min`,
    `Total: ${formatPrice(totalPrice)}`,
  ];

  return sendSMS(salonId, phone, messageLines.join('\n'));
}

export async function sendInternalCancellationNotificationSms(
  salonId: string,
  params: InternalCancellationNotificationSmsParams,
): Promise<boolean> {
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return false;
  }

  const {
    phone,
    salonName,
    clientName,
    clientPhone,
    services,
    startTime,
    cancelReason,
    technicianName,
    timeZone,
  } = params;

  const appointmentTime = formatAppointmentRange(startTime, 0, timeZone).replace(/-.+$/, '');

  const statusLabel = cancelReason === 'no_show'
    ? 'marked as no-show'
    : 'cancelled';

  const messageLines = [
    `Appointment ${statusLabel}${salonName ? ` at ${salonName}` : ''}`,
    '',
    services.join(', '),
    appointmentTime,
    '',
    `Client: ${clientName}`,
  ];

  if (clientPhone) {
    messageLines.push(`Phone: ${clientPhone}`);
  }

  if (technicianName) {
    messageLines.push(`Artist: ${technicianName}`);
  }

  if (cancelReason !== 'client_request') {
    messageLines.push(`Reason: ${cancelReason.replaceAll('_', ' ')}`);
  }

  return sendSMS(salonId, phone, messageLines.join('\n'));
}

/**
 * Send appointment reminder SMS to the client
 */
export async function sendAppointmentReminder(
  salonId: string,
  params: ReminderParams,
): Promise<boolean> {
  // Check if SMS is enabled for this salon
  if (!await isSmsEnabled(salonId)) {
    console.warn('[SMS DISABLED] SMS reminders not enabled for salon:', salonId);
    return false;
  }
  if (!await hasTransactionalSmsConsent(salonId, params.phone)) {
    console.warn('[SMS CONSENT MISSING] Appointment reminder skipped:', salonId);
    return false;
  }

  const {
    phone,
    clientName,
    salonName,
    startTime,
    hoursUntil,
    kind = 'generic',
    services = [],
    technicianName = null,
    timeZone,
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

  const message = kind === 'day_before'
    ? [
        `Hi ${clientName || 'there'}!`,
        '',
        `Reminder: Your appointment at ${salonName} is tomorrow at ${formattedTime}.`,
        ...(services.length > 0 ? [`Service: ${services.join(', ')}`] : []),
        ...(technicianName ? [`Artist: ${technicianName}`] : []),
        'Need to reschedule? Reply or call us.',
      ].join('\n')
    : kind === 'same_day'
      ? [
          `Hi ${clientName || 'there'}!`,
          '',
          `Your appointment at ${salonName} is today at ${formattedTime}.`,
          ...(services.length > 0 ? [`Service: ${services.join(', ')}`] : []),
          ...(technicianName ? [`Artist: ${technicianName}`] : []),
          `See you soon on ${formattedDate}.`,
        ].join('\n')
      : `Hi ${clientName || 'there'},

Reminder: Your appointment at ${salonName} is ${timeUntilText} at ${formattedTime}.

Need to reschedule? Reply or call us.`;

  return sendSMS(salonId, phone, message, {
    appointmentId: params.appointmentId,
    purpose: kind === 'day_before' ? 'appointment_reminder_24h' : kind === 'same_day' ? 'appointment_reminder_2h' : 'appointment_reminder',
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
  if (!await hasTransactionalSmsConsent(salonId, params.phone)) {
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
  if (!await hasTransactionalSmsConsent(salonId, params.phone)) {
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

    console.warn('[TECH NOTIFICATION]', message);
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
