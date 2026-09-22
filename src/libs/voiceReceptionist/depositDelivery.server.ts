import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import { sendAppointmentOperationalEmailOnce } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { resumeCustomerDepositCheckout } from '@/libs/deposits/resumeCustomerCheckout';
import { appointmentSchema } from '@/models/Schema';

import { createCustomerContactBinding } from '../customerAssistant/contact.server';
import { readCustomerBookingOperation } from '../customerAssistant/operationStore.server';

export type VoiceDepositDeliveryStatus = 'accepted' | 'pending' | 'failed' | 'unavailable';

type VerifiedVoiceDeposit = {
  appointmentId: string;
  checkoutUrl: string;
  sessionId: string;
  contactBinding: string;
};

function equalBinding(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}

/**
 * Sends an already-created, still-valid Stripe checkout URL to the appointment's
 * operational email. The URL never leaves this server function's email content.
 */
export async function sendVoiceDepositLink(args: {
  salonId: string;
  capability: string;
  secret: string;
}): Promise<VoiceDepositDeliveryStatus> {
  let verified: VerifiedVoiceDeposit | null = null;
  try {
    const operation = await readCustomerBookingOperation({
      salonId: args.salonId,
      capability: args.capability,
      secret: args.secret,
    });
    if (!operation.appointmentId) {
      return 'unavailable';
    }
    const [appointment] = await db.select({
      id: appointmentSchema.id,
      salonId: appointmentSchema.salonId,
      status: appointmentSchema.status,
      clientName: appointmentSchema.clientName,
      clientEmail: appointmentSchema.clientEmail,
      clientPhone: appointmentSchema.clientPhone,
      holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
    }).from(appointmentSchema).where(and(
      eq(appointmentSchema.id, operation.appointmentId),
      eq(appointmentSchema.salonId, args.salonId),
      eq(appointmentSchema.status, 'awaiting_payment'),
      isNull(appointmentSchema.deletedAt),
      gt(appointmentSchema.depositHoldExpiresAt, new Date()),
    )).limit(1);
    if (!appointment || !appointment.clientName || !appointment.clientEmail || !appointment.holdExpiresAt) {
      return 'unavailable';
    }
    const binding = createCustomerContactBinding({
      secret: args.secret,
      salonId: args.salonId,
      sessionId: operation.sessionId,
      contact: { name: appointment.clientName, email: appointment.clientEmail, phone: appointment.clientPhone },
    });
    if (!equalBinding(binding, operation.contactBinding)) {
      return 'unavailable';
    }
    const checkoutUrl = await resumeCustomerDepositCheckout({ salonId: args.salonId, appointmentId: appointment.id });
    if (!checkoutUrl) {
      return 'unavailable';
    }
    verified = {
      appointmentId: appointment.id,
      checkoutUrl,
      sessionId: operation.sessionId,
      contactBinding: operation.contactBinding,
    };
  } catch {
    return 'failed';
  }

  const delivery = await sendAppointmentOperationalEmailOnce({
    salonId: args.salonId,
    appointmentId: verified.appointmentId,
    purpose: 'voice_deposit_checkout',
    eventVersion: 'v1',
    retryFailed: true,
    // The checkout can expire or be paid while the message is being prepared.
    validateBeforeDelivery: async (recipient) => {
      const [current] = await db.select({
        id: appointmentSchema.id,
        clientName: appointmentSchema.clientName,
        clientEmail: appointmentSchema.clientEmail,
        clientPhone: appointmentSchema.clientPhone,
      }).from(appointmentSchema).where(and(
        eq(appointmentSchema.id, verified!.appointmentId),
        eq(appointmentSchema.salonId, args.salonId),
        eq(appointmentSchema.status, 'awaiting_payment'),
        isNull(appointmentSchema.deletedAt),
        gt(appointmentSchema.depositHoldExpiresAt, new Date()),
      )).limit(1);
      if (!current?.clientName || !current.clientEmail) {
        return false;
      }
      return equalBinding(createCustomerContactBinding({
        secret: args.secret,
        salonId: args.salonId,
        sessionId: verified!.sessionId,
        // Bind the actual canonical recipient chosen by the shared sender,
        // not merely the potentially older appointment contact snapshot.
        contact: { name: current.clientName, email: recipient.email, phone: current.clientPhone },
      }), verified!.contactBinding);
    },
    validationErrorCode: 'VOICE_DEPOSIT_NO_LONGER_PAYABLE',
    prepare: () => ({
      subject: 'Secure deposit payment link',
      text: `Your appointment requires a deposit. Pay securely using this link: ${verified!.checkoutUrl}\n\nDo not reply with card details. Your appointment is confirmed after the required payment is complete.`,
      html: `<p>Your appointment requires a deposit.</p><p><a href="${escapeHtml(verified!.checkoutUrl)}">Pay your deposit securely</a></p><p>Do not reply with card details. Your appointment is confirmed after the required payment is complete.</p>`,
    }),
  });
  return delivery.status === 'sent'
    ? 'accepted'
    : delivery.status === 'duplicate'
      ? 'pending'
      : delivery.status === 'unavailable'
        ? 'unavailable'
        : 'failed';
}
