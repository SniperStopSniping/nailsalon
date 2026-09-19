import type { CustomerBookingStatus } from './bookingOperationContracts';
import { clearNormalConfirmHandoff } from './normalConfirmHandoff.client';

export function canStartAnotherBooking(status: CustomerBookingStatus['status']): boolean {
  return ['confirmed', 'awaiting_approval', 'completed', 'cancelled', 'expired'].includes(status);
}

/** Explicit customer action only, after authoritative status recovery. Old per-flow capability remains recoverable. */
export function startAnotherBooking(salonId: string, salonSlug: string, status: CustomerBookingStatus['status']): void {
  if (!canStartAnotherBooking(status)) {
    throw new Error('BOOKING_STILL_UNRESOLVED');
  }
  sessionStorage.removeItem(`luster.customer-assistant.conversation.${salonSlug}`);
  localStorage.removeItem(`luster.customer-booking.operation.${salonId}`);
  clearNormalConfirmHandoff(salonId);
}
