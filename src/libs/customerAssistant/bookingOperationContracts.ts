import type { BookingSmsConsentInput } from '@/libs/bookingSmsConsent';

import type { CustomerDatePreference, CustomerSelection } from './contracts';
import type { CustomerReadyReviewSnapshot } from './reviewContracts';

/** Server-built material only. Contact and bearer capabilities are never stored here. */
export type CustomerBookingMaterial = {
  selection: CustomerSelection;
  catalogAcknowledgment?: { serviceId: string; resolutionFingerprint: string };
  preference: CustomerDatePreference;
  startTime: string;
  technicianSelection: 'any' | 'specific';
  technicianId?: string;
  locationId?: string;
  review: CustomerReadyReviewSnapshot;
  smsConsent?: BookingSmsConsentInput;
  expectedTotalCents: number;
  expectedDiscountType: string | null;
  expectedBookingFinancialQuote: {
    currency: string;
    totalDueCents: number;
    taxConfigurationIdentity: string;
  };
  expectedDepositFingerprint: string;
  /** Server-resolved opaque offer reference; the public bearer token is never durable material. */
  nextVisitOffer?: { campaignId: string; entitlementId: string };
};

export type CustomerBookingOperationReference = {
  capability: string;
  revision: number;
  fingerprint: string;
  expiresAt: string;
};

export type CustomerBookingFailure = 'slot_unavailable' | 'review_changed' | 'existing_appointment' | 'contact_conflict';

export type CustomerBookingStatus = {
  kind: 'booking_status';
  operation: CustomerBookingOperationReference;
  status: 'not_created' | 'payment_processing' | 'payment_required' | 'awaiting_approval' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'expired' | 'unavailable';
  review: CustomerReadyReviewSnapshot;
  appointment: null | {
    id: string;
    startTime: string;
    durationMinutes: number;
    technicianName: string | null;
    reminderState: 'enabled' | 'customer_disabled' | 'opted_out' | 'salon_disabled' | 'unrecorded';
  };
  payment: null | { amountCents: number; currency: string; holdExpiresAt: string; canResume: boolean };
  lastFailure: CustomerBookingFailure | null;
};
