import { z } from 'zod';

import { customerContactRequestSchema } from './contact';
import type { CustomerAssistantResult } from './contracts';

export const customerReviewRequestSchema = z.object({
  conversation: z.string().min(1).max(24_576),
  contact: customerContactRequestSchema,
}).strict();

export type CustomerReviewRequest = z.infer<typeof customerReviewRequestSchema>;

export type CustomerReviewLocation = {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
};

export type CustomerReviewService = { id: string; name: string; priceCents: number };
export type CustomerReviewAddOn = { id: string; name: string; quantity: number; priceCents: number };

export type CustomerReviewDeposit =
  | { status: 'required'; amountCents: number; currency: string; label: string }
  | { status: 'not_required'; reason: string }
  | { status: 'undetermined' };

export type CustomerReviewPolicy =
  | { required: false }
  | { required: true; title: string; text: string; acknowledgmentText: string; version: string };

/**
 * A display-only preflight. It never grants booking authority and explicitly
 * leaves client-identity pricing and the SMS preference contract unresolved.
 */
export type CustomerReviewSnapshot = {
  status: 'INCOMPLETE';
  fingerprint: string;
  expiresAt: string;
  salon: { id: string; name: string; slug: string };
  location: CustomerReviewLocation | null;
  services: CustomerReviewService[];
  addOns: CustomerReviewAddOn[];
  technician: { kind: 'any_artist' };
  date: string;
  time: string;
  timeZone: string;
  durationMinutes: number;
  financial: {
    subtotalCents: number;
    estimatedTaxCents: number;
    estimatedTotalCents: number;
    currency: string;
  };
  deposit: CustomerReviewDeposit;
  confirmationMode: 'instant' | 'request_approval';
  bookingPolicy: CustomerReviewPolicy;
  blockers: ['reminder_integration', 'identity_pricing'];
};

export type CustomerReviewResponse = {
  conversation: string;
  result:
    | { kind: 'review_prepared'; review: CustomerReviewSnapshot }
    | CustomerAssistantResult;
};
