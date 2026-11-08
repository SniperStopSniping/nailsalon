// Standalone closed-fixture fence. No executable quote, provider authority or money writer.
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

type ClosedCheckoutProjection = {
  sessionId: string;
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'unpaid' | 'paid';
  paymentIntentId: string | null;
  chargeId: string | null;
  feeCheck: 'awaiting_intent' | 'intent_amount_matches' | 'captured_charge_amount_matches';
  financialPostingAllowed: false;
};

export type ClosedCheckoutState = 'prepared' | 'leased' | 'dispatch_intent' | 'uncertain' | 'session_observed' | 'review';
export type ClosedCheckoutReason = 'not_dispatched' | 'create_leased' | 'dispatch_intent' | 'create_consumed' | 'create_outcome_unknown' | 'session_response' | 'retrieval_pending' | 'retrieval_unresolved' | 'no_bound_session' | 'source_context_changed' | 'session_evidence_mismatch' | 'object_ownership_conflict' | 'identity_conflict';
export const closedCheckoutOperationSchema = pgTable('customer_payment_closed_checkout_operation', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  salonId: text('salon_id').notNull(),
  appointmentId: text('appointment_id').notNull(),
  quoteId: text('quote_id').notNull(),
  contextHash: text('context_hash').notNull(),
  identityHash: text('identity_hash').notNull(),
  parameterHash: text('parameter_hash').notNull(),
  platformAccountId: text('platform_account_id').notNull(),
  connectedAccountId: text('connected_account_id').notNull(),
  mode: text('mode').$type<'test'>().notNull().default('test'),
  source: text('source').$type<'closed_test_fixture'>().notNull().default('closed_test_fixture'),
  providerOriginVerified: boolean('provider_origin_verified').notNull().default(false),
  financialPostingAllowed: boolean('financial_posting_allowed').notNull().default(false),
  operationCreatedAt: timestamp('operation_created_at', { withTimezone: true, mode: 'date' }).notNull(),
  quoteExpiresAt: timestamp('quote_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({
  requestOnce: uniqueIndex('closed_checkout_request_once').on(table.requestId),
  appointmentOnce: uniqueIndex('closed_checkout_appointment_once').on(table.salonId, table.appointmentId),
}));
export const closedCheckoutStateSchema = pgTable('customer_payment_closed_checkout_state', {
  operationId: text('operation_id').primaryKey().references(() => closedCheckoutOperationSchema.id, { onDelete: 'restrict' }),
  version: integer('version').notNull().default(0),
  state: text('state').$type<ClosedCheckoutState>().notNull().default('prepared'),
  reason: text('reason').$type<ClosedCheckoutReason>().notNull().default('not_dispatched'),
  dispatchIntentAt: timestamp('dispatch_intent_at', { withTimezone: true, mode: 'date' }),
  createConsumedAt: timestamp('create_consumed_at', { withTimezone: true, mode: 'date' }),
  workerId: text('worker_id'),
  leaseToken: text('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
  activity: text('activity').$type<'create' | 'retrieve'>(),
  session: jsonb('session').$type<ClosedCheckoutProjection>(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
export const closedCheckoutObjectSchema = pgTable('customer_payment_closed_checkout_object', {
  platformAccountId: text('platform_account_id').notNull(),
  connectedAccountId: text('connected_account_id').notNull(),
  mode: text('mode').$type<'test'>().notNull().default('test'),
  objectId: text('object_id').notNull(),
  operationId: text('operation_id').notNull().references(() => closedCheckoutOperationSchema.id, { onDelete: 'restrict' }),
}, table => ({ scope: primaryKey({ columns: [table.platformAccountId, table.connectedAccountId, table.mode, table.objectId] }) }));
export const closedCheckoutAuditSchema = pgTable('customer_payment_closed_checkout_audit', {
  operationId: text('operation_id').notNull().references(() => closedCheckoutOperationSchema.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: primaryKey({ columns: [table.operationId, table.version] }) }));
export const closedCheckoutConflictSchema = pgTable('customer_payment_closed_checkout_conflict', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull().references(() => closedCheckoutOperationSchema.id, { onDelete: 'restrict' }),
  contenderIdentityHash: text('contender_identity_hash').notNull(),
  reason: text('reason').$type<'identity_conflict' | 'object_ownership_conflict'>().notNull(),
  objectId: text('object_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
export const closedCheckoutObservationSchema = pgTable('customer_payment_closed_checkout_observation', {
  operationId: text('operation_id').notNull().references(() => closedCheckoutOperationSchema.id, { onDelete: 'restrict' }),
  fingerprint: text('fingerprint').notNull(),
  claimVersion: integer('claim_version').notNull(),
  outcome: text('outcome').$type<'accepted' | 'rejected'>().notNull(),
  late: boolean('late').notNull(),
  sessionId: text('session_id'),
  paymentIntentId: text('payment_intent_id'),
  chargeId: text('charge_id'),
  status: text('status'),
  paymentStatus: text('payment_status'),
  feeCheck: text('fee_check'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: primaryKey({ columns: [table.operationId, table.fingerprint] }) }));
