import { z } from 'zod';

import { adjustedBillSchema, adjustmentPaymentSchema, adjustmentRefundSchema, adjustmentRequestSchema } from '../adjustments';

const identity = z.string().min(1).max(200);
const cents = z.number().int().min(0).max(50_000_000);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const paymentWorkspaceScopeSchema = z.object({ salonId: identity, appointmentId: identity }).strict();
export type PaymentWorkspaceScope = z.infer<typeof paymentWorkspaceScopeSchema>;

/** Saved with each operation; reconnecting a salon cannot move old money. */
export const paymentProviderBindingSchema = z.object({
  platformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200),
  connectedAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200),
  livemode: z.boolean(),
  currency: z.literal('cad'),
  bindingId: identity,
  returnOrigin: z.string().url().max(500).refine((value) => {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  }),
}).strict().refine(value => value.platformAccountId !== value.connectedAccountId);
export type PaymentProviderBinding = z.infer<typeof paymentProviderBindingSchema>;

export const workspaceOperationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['payment', 'refund']),
  state: z.enum(['awaiting_approval', 'prepared', 'dispatching', 'open', 'pending', 'uncertain', 'succeeded', 'failed', 'canceled', 'review']),
  billRevision: z.number().int().nonnegative(),
  principalCents: cents,
  tipCents: cents,
  binding: paymentProviderBindingSchema,
  parentPaymentId: identity.nullable(),
  parentChargeId: z.string().regex(/^ch_[A-Za-z0-9]+$/).max(200).nullable(),
  requestedBy: identity,
  approvedBy: identity.nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
  createdAt: timestamp,
  sessionExpiresAt: timestamp.nullable(),
  firstDispatchAt: timestamp.nullable(),
  dispatchToken: z.string().uuid().nullable(),
  dispatchUntil: timestamp.nullable(),
  providerObjectId: identity.nullable(),
}).strict();
export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>;

export const paymentWorkspaceStateSchema = z.object({
  revision: z.number().int().nonnegative().max(2147483646),
  bill: adjustedBillSchema,
  /** Hash of the authoritative invoice, including its items and tax snapshot. */
  billSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  billChanges: z.array(z.object({ revision: z.number().int().positive(), reason: z.string().trim().min(1).max(500), actorId: identity, changedAt: timestamp, sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(1000).default([]),
  payments: z.array(adjustmentPaymentSchema).max(1000),
  refunds: z.array(adjustmentRefundSchema).max(1000),
  requests: z.array(adjustmentRequestSchema).max(1000),
  operations: z.array(workspaceOperationSchema).max(1000),
}).strict();
export type PaymentWorkspaceState = z.infer<typeof paymentWorkspaceStateSchema>;

/** These fields come from the authenticated server guard, never the JSON body. */
export type PaymentWorkspaceActor = PaymentWorkspaceScope & {
  id: string;
  role: 'owner' | 'staff' | 'admin';
  impersonating: boolean;
  canEditItems: boolean;
  canRecordPayment: boolean;
};

const command = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().max(2147483646) });
export const paymentWorkspaceCommandSchema = z.discriminatedUnion('kind', [
  command.extend({ kind: z.literal('request_payment') }).strict(),
  command.extend({ kind: z.literal('request_refund'), paymentId: identity, principalCents: cents, tipCents: cents, reason: z.string().trim().min(1).max(500) }).strict(),
  command.extend({ kind: z.literal('approve_refund'), operationId: z.string().uuid() }).strict(),
  command.extend({ kind: z.literal('reject_refund'), operationId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).strict(),
]);
export type PaymentWorkspaceCommand = z.infer<typeof paymentWorkspaceCommandSchema>;

export const workspaceBillChangeSchema = command.extend({
  changeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(500),
}).strict();
export const workspaceManualPaymentSchema = command.extend({
  amountCents: cents.min(1),
  method: z.enum(['cash', 'debit', 'credit', 'e_transfer', 'gift_card', 'other']),
}).strict();

export class PaymentWorkspaceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PaymentWorkspaceError';
  }
}

export function workspaceFailure(code: string): never {
  throw new PaymentWorkspaceError(code);
}
