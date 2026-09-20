import { z } from 'zod';

import { PAYMENT_METHODS } from '@/libs/paymentMethods';

// Catalog IDs are opaque text keys. Completion must accept the same IDs as booking.
const paymentMethodEnum = z.enum(PAYMENT_METHODS);

const finalItemSchema = z.object({
  kind: z.enum(['service', 'addon', 'custom']),
  catalogServiceId: z.string().nullish(),
  catalogAddOnId: z.string().nullish(),
  name: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(99).default(1),
  unitPriceCents: z.number().int().min(0).max(1_000_000),
  durationMinutes: z.number().int().min(0).max(600).nullish(),
  /** Defaults from the salon tax config per kind when omitted. */
  taxable: z.boolean().optional(),
});

const paymentEntrySchema = z.object({
  amountCents: z.number().int().min(1).max(5_000_000),
  method: paymentMethodEnum.optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export const completeAppointmentSchema = z.object({
  // Photo gate: policy 'required' ignores this flag; otherwise it preserves
  // the long-standing soft gate (missing after photo → 400 unless skipped).
  skipPhotoValidation: z.boolean().optional().default(false),

  // Legacy completion record (kept for back-compat: a body with none of the
  // new checkout fields completes exactly as before this phase).
  finalPriceCents: z.number().int().min(0).max(1_000_000).optional(),
  tipCents: z.number().int().min(0).max(100_000).optional(),
  paymentMethod: paymentMethodEnum.optional(),
  techNotes: z.string().trim().max(2000).optional(),

  // Legacy performed-item ids — translated into final items (the booked
  // appointment_services/appointment_add_on snapshot is IMMUTABLE now).
  performedServiceIds: z.array(z.string()).max(20).optional(),
  performedAddOnIds: z.array(z.string()).max(20).optional(),

  // Checkout payload (0058)
  finalItems: z.array(finalItemSchema).max(40).optional(),
  actualStartAt: z.coerce.date().optional(),
  actualEndAt: z.coerce.date().optional(),
  discountCents: z.number().int().min(0).max(1_000_000).optional(),
  discountReason: z.string().trim().max(200).optional(),
  // Admin-only
  taxExempt: z.boolean().optional(),
  // An empty or whitespace-only reason is "no reason supplied". Normalizing it
  // to absent here keeps the stored scalar and the frozen snapshot identical:
  // a stored '' beside a snapshot null would permanently fail chain validation.
  taxExemptReason: z.string().trim().max(200).optional()
    .transform(value => value || undefined),
  // Payments recorded at checkout. PRESENCE of this field (even empty) opts
  // into derived payment status; absence keeps the legacy hard-coded 'paid'.
  payments: z.array(paymentEntrySchema).max(10).optional(),
  // Admin-only. 'comp' = complimentary (0 revenue, no payments allowed).
  paymentStatusIntent: z.literal('comp').optional(),
  // Optimistic-concurrency check: server recomputes and 409s on drift.
  expectedTotalDueCents: z.number().int().min(0).max(10_000_000).optional(),
  // The client-reviewed amount before this request's new payment entries.
  // Revalidated while holding appointment -> deposit locks.
  expectedBalanceCents: z.number().int().min(0).max(10_000_000).optional(),
});

export type CompletePayload = z.infer<typeof completeAppointmentSchema>;

export type CompletionValidationIssue = { path: string; message: string };

/** Safe owner-facing feedback: never echo submitted values or database errors. */
export function completionValidationIssues(issues: Array<{ path: Array<string | number> }>): CompletionValidationIssue[] {
  return issues.map(({ path }) => {
    const field = String(path.at(-1) ?? '');
    const item = path[0] === 'finalItems' && typeof path[1] === 'number' ? `Item ${path[1] + 1}` : 'Services & items';
    const messages: Record<string, string> = {
      finalItems: 'Check your services and items (up to 40 items).',
      name: `${item}: enter a name of 1–120 characters.`,
      quantity: `${item}: enter a whole quantity from 1 to 99.`,
      unitPriceCents: `${item}: enter a valid nonnegative price.`,
      durationMinutes: `${item}: enter a duration from 0 to 600 minutes.`,
      catalogServiceId: `${item}: this service reference is unavailable. Reload the appointment and select the service again.`,
      catalogAddOnId: `${item}: this add-on reference is unavailable. Reload the appointment and select the add-on again.`,
      kind: `${item}: choose a service, add-on, or custom item.`,
      taxable: `${item}: check whether tax applies.`,
      discountCents: 'Enter a valid nonnegative discount.',
      discountReason: 'Keep the discount reason within 200 characters.',
      tipCents: 'Enter a valid nonnegative tip within the allowed limit.',
      taxExempt: 'Check the tax exemption selection.',
      taxExemptReason: 'Keep the tax exemption reason within 200 characters.',
      actualStartAt: 'Enter a valid actual start time or leave it blank.',
      actualEndAt: 'Enter a valid actual finish time or leave it blank.',
      amountCents: 'Enter a valid payment amount greater than zero, or choose record payment later.',
      payments: 'Check the payments being recorded (up to 10 payments).',
      method: 'Choose a supported payment method, or leave the optional method blank.',
      paymentMethod: 'Choose a supported payment method, or leave the optional method blank.',
      reference: 'Keep the payment reference within 120 characters.',
      note: 'Keep the payment note within 500 characters.',
      techNotes: 'Keep the private note within 2,000 characters.',
      expectedTotalDueCents: 'The total is invalid. Check the services, discount, and tip.',
      expectedBalanceCents: 'The balance is invalid. Reload the appointment before recording payment.',
      paymentStatusIntent: 'Check the complimentary appointment selection.',
    };
    return { path: path.join('.'), message: messages[field] ?? 'Check the appointment details before completing.' };
  });
}
