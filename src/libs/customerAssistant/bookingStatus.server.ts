import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { getAppointmentSmsDeliveryPreference } from '@/libs/bookingSmsConsent.server';
import { db } from '@/libs/DB';
import { appointmentDepositSchema, appointmentSchema, technicianSchema } from '@/models/Schema';

import type { CustomerBookingStatus } from './bookingOperationContracts';
import { type CustomerBookingOperation, customerBookingOperationReference } from './operationStore.server';

/** Capability authentication precedes this read. No message, link or provider call. */
export async function readCustomerBookingStatus(operation: CustomerBookingOperation, secret: string, now = new Date()): Promise<CustomerBookingStatus> {
  const base: CustomerBookingStatus = {
    kind: 'booking_status',
    operation: customerBookingOperationReference(operation, secret),
    status: 'not_created',
    review: operation.material.review,
    appointment: null,
    payment: null,
    lastFailure: operation.lastFailure,
  };
  if (!operation.appointmentId) {
    return base;
  }
  const [appointment] = await db.select({
    id: appointmentSchema.id,
    status: appointmentSchema.status,
    startTime: appointmentSchema.startTime,
    durationMinutes: appointmentSchema.totalDurationMinutes,
    technicianName: technicianSchema.name,
    phone: appointmentSchema.clientPhone,
    holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
    depositAmountCents: appointmentDepositSchema.amountCents,
    depositCurrency: appointmentDepositSchema.currency,
    depositStatus: appointmentDepositSchema.status,
  }).from(appointmentSchema).leftJoin(technicianSchema, and(
    eq(technicianSchema.id, appointmentSchema.technicianId),
    eq(technicianSchema.salonId, appointmentSchema.salonId),
  )).leftJoin(appointmentDepositSchema, and(
    eq(appointmentDepositSchema.appointmentId, appointmentSchema.id),
    eq(appointmentDepositSchema.salonId, appointmentSchema.salonId),
  )).where(and(
    eq(appointmentSchema.id, operation.appointmentId),
    eq(appointmentSchema.salonId, operation.salonId),
    isNull(appointmentSchema.deletedAt),
  )).limit(1);
  if (!appointment) {
    return { ...base, status: 'unavailable' };
  }
  const reminder = await getAppointmentSmsDeliveryPreference({ salonId: operation.salonId, appointmentId: appointment.id, phone: appointment.phone });
  base.appointment = {
    id: appointment.id,
    startTime: appointment.startTime.toISOString(),
    durationMinutes: appointment.durationMinutes,
    technicianName: appointment.technicianName,
    reminderState: reminder.state,
  };
  if (appointment.status === 'awaiting_payment') {
    if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= now) {
      // A deadline alone cannot establish expiry: settlement may still arrive.
      return { ...base, status: 'payment_processing' };
    }
    if (appointment.depositAmountCents === null || !appointment.depositCurrency) {
      return { ...base, status: 'unavailable' };
    }
    if (appointment.depositStatus !== 'checkout_created') {
      return { ...base, status: 'payment_processing' };
    }
    return {
      ...base,
      status: 'payment_required',
      payment: { amountCents: appointment.depositAmountCents, currency: appointment.depositCurrency.toUpperCase(), holdExpiresAt: appointment.holdExpiresAt.toISOString(), canResume: true },
    };
  }

  const status: CustomerBookingStatus['status'] = appointment.status === 'pending'
    ? 'awaiting_approval'
    : appointment.status === 'confirmed' || appointment.status === 'in_progress' || appointment.status === 'completed' || appointment.status === 'cancelled'
      ? appointment.status
      : 'unavailable';
  return { ...base, status };
}
