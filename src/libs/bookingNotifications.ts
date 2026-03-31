import 'server-only';

import { sendTransactionalEmail } from '@/libs/email';
import { normalizePhone } from '@/libs/phone';
import {
  resolveBookingNotificationCapabilities,
  resolveBookingNotificationSettingsFromSettings,
} from '@/libs/bookingNotificationSettings';
import {
  sendInternalBookingNotificationSms,
  sendInternalCancellationNotificationSms,
} from '@/libs/SMS';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

type RecipientLabel = 'owner' | 'technician';
type DeliveryChannel = 'sms' | 'email';
type NotificationChannelSetting = 'sms' | 'email' | 'both';
type NotificationEventType = 'new_booking' | 'appointment_cancelled';

type BookingTechnician = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
} | null;

type BookingSalon = {
  id: string;
  name: string;
  ownerName?: string | null;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
  features?: SalonFeatures | null;
  settings?: SalonSettings | null;
};

export type NewBookingNotificationContext = {
  salon: BookingSalon;
  technician: BookingTechnician;
  appointmentId: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  startTime: string;
  totalDurationMinutes: number;
  totalPrice: number;
};

export type AppointmentCancelledNotificationContext = {
  salon: BookingSalon;
  technician: BookingTechnician;
  appointmentId: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  startTime: string;
  cancelReason: string;
};

type Recipient = {
  channel: DeliveryChannel;
  destination: string;
  labels: RecipientLabel[];
};

type EmailPayload = {
  subject: string;
  text: string;
  html: string;
};

type NotificationEventSettings = {
  technicianEnabled: boolean;
  ownerEnabled: boolean;
  technicianChannel: NotificationChannelSetting;
  ownerChannel: NotificationChannelSetting;
};

export async function sendBookingNotificationsForNewBooking(
  context: NewBookingNotificationContext,
): Promise<void> {
  const settings = resolveBookingNotificationSettingsFromSettings(context.salon.settings);
  const capabilities = resolveBookingNotificationCapabilities({
    features: context.salon.features,
    settings: context.salon.settings,
    ownerPhone: context.salon.ownerPhone,
    ownerEmail: context.salon.ownerEmail,
  });

  const recipients = resolveRecipients({
    eventSettings: settings.newBooking,
    capabilities,
    salon: context.salon,
    technician: context.technician,
    appointmentId: context.appointmentId,
    eventType: 'new_booking',
  });

  if (recipients.length === 0) {
    return;
  }

  await deliverInternalNotifications({
    eventType: 'new_booking',
    appointmentId: context.appointmentId,
    salonId: context.salon.id,
    recipients,
    emailPayload: buildNewBookingEmailPayload(context),
    sendSms: recipient => sendInternalBookingNotificationSms(context.salon.id, {
      phone: recipient.destination,
      salonName: context.salon.name,
      clientName: context.clientName,
      clientPhone: context.clientPhone,
      services: context.services,
      startTime: context.startTime,
      totalDurationMinutes: context.totalDurationMinutes,
      totalPrice: context.totalPrice,
      technicianName: context.technician?.name ?? null,
    }),
  });
}

export async function sendBookingNotificationsForAppointmentCancelled(
  context: AppointmentCancelledNotificationContext,
): Promise<void> {
  if (context.cancelReason === 'rescheduled') {
    return;
  }

  const settings = resolveBookingNotificationSettingsFromSettings(context.salon.settings);
  const capabilities = resolveBookingNotificationCapabilities({
    features: context.salon.features,
    settings: context.salon.settings,
    ownerPhone: context.salon.ownerPhone,
    ownerEmail: context.salon.ownerEmail,
  });

  const recipients = resolveRecipients({
    eventSettings: settings.appointmentCancelled,
    capabilities,
    salon: context.salon,
    technician: context.technician,
    appointmentId: context.appointmentId,
    eventType: 'appointment_cancelled',
  });

  if (recipients.length === 0) {
    return;
  }

  await deliverInternalNotifications({
    eventType: 'appointment_cancelled',
    appointmentId: context.appointmentId,
    salonId: context.salon.id,
    recipients,
    emailPayload: buildAppointmentCancelledEmailPayload(context),
    sendSms: recipient => sendInternalCancellationNotificationSms(context.salon.id, {
      phone: recipient.destination,
      salonName: context.salon.name,
      clientName: context.clientName,
      clientPhone: context.clientPhone,
      services: context.services,
      startTime: context.startTime,
      cancelReason: context.cancelReason,
      technicianName: context.technician?.name ?? null,
    }),
  });
}

function resolveRecipients(args: {
  eventSettings: NotificationEventSettings;
  capabilities: ReturnType<typeof resolveBookingNotificationCapabilities>;
  salon: BookingSalon;
  technician: BookingTechnician;
  appointmentId: string;
  eventType: NotificationEventType;
}): Recipient[] {
  const recipients = new Map<string, Recipient>();

  if (args.eventSettings.technicianEnabled && args.technician) {
    addRecipientChannels({
      recipients,
      requestedChannel: args.eventSettings.technicianChannel,
      phone: args.technician.phone,
      email: args.technician.email,
      smsChannelAvailable: args.capabilities.smsChannelAvailable,
      emailChannelAvailable: args.capabilities.emailChannelAvailable,
      label: 'technician',
      salonId: args.salon.id,
      appointmentId: args.appointmentId,
      eventType: args.eventType,
    });
  }

  if (args.eventSettings.ownerEnabled) {
    addRecipientChannels({
      recipients,
      requestedChannel: args.eventSettings.ownerChannel,
      phone: args.salon.ownerPhone,
      email: args.salon.ownerEmail,
      smsChannelAvailable: args.capabilities.smsChannelAvailable,
      emailChannelAvailable: args.capabilities.emailChannelAvailable,
      label: 'owner',
      salonId: args.salon.id,
      appointmentId: args.appointmentId,
      eventType: args.eventType,
    });
  }

  return Array.from(recipients.values());
}

async function deliverInternalNotifications(args: {
  eventType: NotificationEventType;
  appointmentId: string;
  salonId: string;
  recipients: Recipient[];
  emailPayload: EmailPayload;
  sendSms: (recipient: Recipient) => Promise<boolean>;
}): Promise<void> {
  const sends = args.recipients.map(async (recipient) => {
    if (recipient.channel === 'sms') {
      const sent = await args.sendSms(recipient);
      if (!sent) {
        logDeliveryFailure({
          eventType: args.eventType,
          appointmentId: args.appointmentId,
          salonId: args.salonId,
          recipient,
          reason: 'send_returned_false',
        });
      }
      return;
    }

    const sent = await sendTransactionalEmail({
      to: recipient.destination,
      subject: args.emailPayload.subject,
      text: args.emailPayload.text,
      html: args.emailPayload.html,
    });

    if (!sent) {
      logDeliveryFailure({
        eventType: args.eventType,
        appointmentId: args.appointmentId,
        salonId: args.salonId,
        recipient,
        reason: 'send_returned_false',
      });
    }
  });

  const results = await Promise.allSettled(sends);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logDeliveryFailure({
        eventType: args.eventType,
        appointmentId: args.appointmentId,
        salonId: args.salonId,
        recipient: args.recipients[index]!,
        reason: 'rejected',
        error: result.reason,
      });
    }
  });
}

function addRecipientChannels(args: {
  recipients: Map<string, Recipient>;
  requestedChannel: NotificationChannelSetting;
  phone?: string | null;
  email?: string | null;
  smsChannelAvailable: boolean;
  emailChannelAvailable: boolean;
  label: RecipientLabel;
  salonId: string;
  appointmentId: string;
  eventType: NotificationEventType;
}): void {
  const wantsSms = args.requestedChannel === 'sms' || args.requestedChannel === 'both';
  const wantsEmail = args.requestedChannel === 'email' || args.requestedChannel === 'both';

  if (wantsSms) {
    if (args.smsChannelAvailable && args.phone) {
      const normalizedPhone = normalizePhone(args.phone);
      if (normalizedPhone.length === 10) {
        upsertRecipient(args.recipients, `sms:${normalizedPhone}`, {
          channel: 'sms',
          destination: normalizedPhone,
          labels: [args.label],
        });
      } else {
        console.warn('[BOOKING NOTIFICATIONS] Skipping SMS recipient with invalid phone:', {
          eventType: args.eventType,
          label: args.label,
          salonId: args.salonId,
          appointmentId: args.appointmentId,
        });
      }
    } else {
      console.warn('[BOOKING NOTIFICATIONS] Skipping SMS recipient:', {
        eventType: args.eventType,
        label: args.label,
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        reason: args.smsChannelAvailable ? 'missing_phone' : 'sms_unavailable',
      });
    }
  }

  if (wantsEmail) {
    if (args.emailChannelAvailable && args.email?.trim()) {
      const normalizedEmail = args.email.trim().toLowerCase();
      upsertRecipient(args.recipients, `email:${normalizedEmail}`, {
        channel: 'email',
        destination: normalizedEmail,
        labels: [args.label],
      });
    } else {
      console.warn('[BOOKING NOTIFICATIONS] Skipping email recipient:', {
        eventType: args.eventType,
        label: args.label,
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        reason: args.emailChannelAvailable ? 'missing_email' : 'email_unavailable',
      });
    }
  }
}

function upsertRecipient(
  recipients: Map<string, Recipient>,
  key: string,
  recipient: Recipient,
): void {
  const existing = recipients.get(key);
  if (!existing) {
    recipients.set(key, recipient);
    return;
  }

  recipients.set(key, {
    ...existing,
    labels: Array.from(new Set([...existing.labels, ...recipient.labels])),
  });
}

function buildNewBookingEmailPayload(context: NewBookingNotificationContext): EmailPayload {
  return buildEmailPayload(
    buildNewBookingSubject(context),
    buildNewBookingText(context),
  );
}

function buildAppointmentCancelledEmailPayload(
  context: AppointmentCancelledNotificationContext,
): EmailPayload {
  return buildEmailPayload(
    buildAppointmentCancelledSubject(context),
    buildAppointmentCancelledText(context),
  );
}

function buildEmailPayload(subject: string, text: string): EmailPayload {
  const html = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<div>${escapeHtml(line)}</div>`)
    .join('');

  return {
    subject,
    text,
    html: `<div>${html}</div>`,
  };
}

function buildNewBookingSubject(context: NewBookingNotificationContext): string {
  const start = new Date(context.startTime);
  const formattedDate = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `New booking: ${context.clientName} on ${formattedDate} at ${formattedTime}`;
}

function buildNewBookingText(context: NewBookingNotificationContext): string {
  const start = new Date(context.startTime);
  const formattedDate = start.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return [
    `New booking at ${context.salon.name}`,
    '',
    `Client: ${context.clientName}`,
    `Phone: ${context.clientPhone}`,
    `Date: ${formattedDate}`,
    `Time: ${formattedTime}`,
    `Services: ${context.services.join(', ')}`,
    `Duration: ${context.totalDurationMinutes} min`,
    `Artist: ${context.technician?.name ?? 'Any available artist'}`,
    `Total: $${(context.totalPrice / 100).toFixed(0)}`,
    `Appointment ID: ${context.appointmentId}`,
  ].join('\n');
}

function buildAppointmentCancelledSubject(
  context: AppointmentCancelledNotificationContext,
): string {
  const start = new Date(context.startTime);
  const formattedDate = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (context.cancelReason === 'no_show') {
    return `No-show: ${context.clientName} on ${formattedDate} at ${formattedTime}`;
  }

  return `Appointment cancelled: ${context.clientName} on ${formattedDate} at ${formattedTime}`;
}

function buildAppointmentCancelledText(
  context: AppointmentCancelledNotificationContext,
): string {
  const start = new Date(context.startTime);
  const formattedDate = start.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const statusLabel = context.cancelReason === 'no_show'
    ? 'marked as no-show'
    : 'cancelled';

  return [
    `Appointment ${statusLabel} at ${context.salon.name}`,
    '',
    `Client: ${context.clientName}`,
    `Phone: ${context.clientPhone}`,
    `Date: ${formattedDate}`,
    `Time: ${formattedTime}`,
    `Services: ${context.services.join(', ')}`,
    `Artist: ${context.technician?.name ?? 'Any available artist'}`,
    ...(context.cancelReason !== 'client_request'
      ? [`Reason: ${context.cancelReason.replaceAll('_', ' ')}`]
      : []),
    `Appointment ID: ${context.appointmentId}`,
  ].join('\n');
}

function logDeliveryFailure(args: {
  eventType: NotificationEventType;
  appointmentId: string;
  salonId: string;
  recipient: Recipient;
  reason: 'send_returned_false' | 'rejected';
  error?: unknown;
}): void {
  console.error('[BOOKING NOTIFICATIONS] Internal notification failed:', {
    eventType: args.eventType,
    appointmentId: args.appointmentId,
    salonId: args.salonId,
    channel: args.recipient.channel,
    destination: args.recipient.destination,
    labels: args.recipient.labels,
    reason: args.reason,
    error: args.error,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}
