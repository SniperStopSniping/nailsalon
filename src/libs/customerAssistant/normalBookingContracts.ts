import { z } from 'zod';

import { customerReviewRequestSchema } from './reviewContracts';

/** Exact normal-screen submission; no model or conversation facts enter this boundary. */
export const normalBookingPrepareSchema = z.object({
  flowToken: z.string().min(1).max(2_048),
  expectedRevision: z.number().int().min(0),
  sourceCapability: z.string().min(1).max(200).optional(),
  booking: z.object({
    salonSlug: z.string().min(1).max(160),
    baseServiceId: z.string().min(1).max(100),
    selectedAddOns: z.array(z.object({ addOnId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(20).default(1) }).strict()).max(20),
    technicianId: z.string().min(1).max(100).nullable(),
    locationId: z.string().min(1).max(100).optional(),
    startTime: z.string().datetime(),
    appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    appointmentTime: z.string().regex(/^\d{2}:\d{2}$/),
    clientName: z.string().min(1).max(120),
    clientEmail: z.string().email().max(254),
    clientPhone: z.string().min(1).max(30),
    bookingSubject: z.literal('guest'),
    smsConsent: customerReviewRequestSchema.shape.smsConsent,
    catalogAcknowledgment: z.object({ serviceId: z.string(), resolutionFingerprint: z.string().length(64) }).strict().nullable().optional(),
    expectedTotalCents: z.number().int().nonnegative().optional(),
    expectedDiscountType: z.string().nullable().optional(),
    expectedBookingFinancialQuote: z.object({ currency: z.string(), totalDueCents: z.number().int().nonnegative(), taxConfigurationIdentity: z.string() }).strict().optional(),
    expectedDepositFingerprint: z.string().min(1),
    bookingPolicyAcknowledgment: z.object({ accepted: z.literal(true), version: z.string(), attemptId: z.string().uuid() }).strict().optional(),
    campaignToken: z.string().optional(),
    manageToken: z.string().optional(),
    originalAppointmentId: z.string().optional(),
  }).strict(),
  displayed: z.object({
    totalCents: z.number().int().nonnegative(),
    durationMinutes: z.number().int().positive(),
    currency: z.string(),
    salonName: z.string(),
    timeZone: z.string(),
    technician: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
    location: z.object({ name: z.string(), address: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable(), zipCode: z.string().nullable() }).strict().nullable(),
    services: z.array(z.object({ id: z.string(), name: z.string(), priceCents: z.number().int() }).strict()),
    addOns: z.array(z.object({ id: z.string(), name: z.string(), quantity: z.number().int(), priceCents: z.number().int() }).strict()),
    manualConfirmationItems: z.array(z.object({ id: z.string(), name: z.string(), quantity: z.number().int(), durationMinutes: z.number().int().nonnegative(), priceStatus: z.literal('to_be_confirmed') }).strict()).max(20).default([]),
    confirmationMode: z.enum(['instant', 'request_approval']),
    reminderMode: z.enum(['default_on', 'default_off', 'disabled']),
    policyVersion: z.string().nullable(),
  }).strict(),
}).strict();
export type NormalBookingPrepare = z.infer<typeof normalBookingPrepareSchema>;
