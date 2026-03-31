import 'server-only';

import { sendTransactionalEmail } from '@/libs/email';
import { normalizePhone } from '@/libs/phone';
import {
  resolveBookingNotificationCapabilities,
  resolveBookingNotificationSettingsFromSettings,
} from '@/libs/bookingNotificationSettings';
import { sendInternalBookingNotificationSms } from '@/libs/SMS';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

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

type Recipient =
  | { channel: 'sms'; destination: string }
  | { channel: 'email'; destination: string };

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

  const recipients = new Map<string, Recipient>();

  if (settings.newBooking.technicianEnabled && context.technician) {
    addRecipientChannels({
      recipients,
      requestedChannel: settings.newBooking.technicianChannel,
      phone: context.technician.phone,
      email: context.technician.email,
      smsChannelAvailable: capabilities.smsChannelAvailable,
      emailChannelAvailable: capabilities.emailChannelAvailable,
      label: 'technician',
      salonId: context.salon.id,
      appointmentId: context.appointmentId,
    });
  }

  if (settings.newBooking.ownerEnabled) {
    addRecipientChannels({
      recipients,
      requestedChannel: settings.newBooking.ownerChannel,
      phone: context.salon.ownerPhone,
      email: context.salon.ownerEmail,
      smsChannelAvailable: capabilities.smsChannelAvailable,
      emailChannelAvailable: capabilities.emailChannelAvailable,
      label: 'owner',
      salonId: context.salon.id,
      appointmentId: context.appointmentId,
    });
  }

  if (recipients.size === 0) {
    return;
  }

  const subject = buildNewBookingSubject(context);
  const text = buildNewBookingText(context);
  const html = buildNewBookingHtml(context);

  const sends = Array.from(recipients.values()).map(async (recipient) => {
    if (recipient.channel === 'sms') {
      await sendInternalBookingNotificationSms(context.salon.id, {
        phone: recipient.destination,
        salonName: context.salon.name,
        clientName: context.clientName,
        clientPhone: context.clientPhone,
        services: context.services,
        startTime: context.startTime,
        totalDurationMinutes: context.totalDurationMinutes,
        totalPrice: context.totalPrice,
        technicianName: context.technician?.name ?? null,
      });
      return;
    }

    await sendTransactionalEmail({
      to: recipient.destination,
      subject,
      text,
      html,
    });
  });

  const results = await Promise.allSettled(sends);
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error('[BOOKING NOTIFICATIONS] Internal notification failed:', {
        recipient: Array.from(recipients.values())[index],
        appointmentId: context.appointmentId,
        error: result.reason,
      });
    }
  });
}

function addRecipientChannels(args: {
  recipients: Map<string, Recipient>;
  requestedChannel: 'sms' | 'email' | 'both';
  phone?: string | null;
  email?: string | null;
  smsChannelAvailable: boolean;
  emailChannelAvailable: boolean;
  label: 'owner' | 'technician';
  salonId: string;
  appointmentId: string;
}): void {
  const wantsSms = args.requestedChannel === 'sms' || args.requestedChannel === 'both';
  const wantsEmail = args.requestedChannel === 'email' || args.requestedChannel === 'both';

  if (wantsSms) {
    if (args.smsChannelAvailable && args.phone) {
      const normalizedPhone = normalizePhone(args.phone);
      if (normalizedPhone.length === 10) {
        args.recipients.set(`sms:${normalizedPhone}`, {
          channel: 'sms',
          destination: normalizedPhone,
        });
      } else {
        console.warn('[BOOKING NOTIFICATIONS] Skipping SMS recipient with invalid phone:', {
          label: args.label,
          salonId: args.salonId,
          appointmentId: args.appointmentId,
        });
      }
    } else {
      console.warn('[BOOKING NOTIFICATIONS] Skipping SMS recipient:', {
        label: args.label,
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        reason: args.smsChannelAvailable ? 'missing_phone' : 'sms_unavailable',
      });
    }
  }

  if (wantsEmail) {
    if (args.emailChannelAvailable && args.email?.trim()) {
      args.recipients.set(`email:${args.email.trim().toLowerCase()}`, {
        channel: 'email',
        destination: args.email.trim().toLowerCase(),
      });
    } else {
      console.warn('[BOOKING NOTIFICATIONS] Skipping email recipient:', {
        label: args.label,
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        reason: args.emailChannelAvailable ? 'missing_email' : 'email_unavailable',
      });
    }
  }
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

function buildNewBookingHtml(context: NewBookingNotificationContext): string {
  const lines = buildNewBookingText(context)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<div>${escapeHtml(line)}</div>`);

  return `<div>${lines.join('')}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}
