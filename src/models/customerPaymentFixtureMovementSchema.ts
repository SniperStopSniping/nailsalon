// Standalone immutable offline ledger. Migration0125 supplies deferred bindings.
import { bigint, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const customerPaymentFixtureReconciliationSchema = pgTable('customer_payment_fixture_reconciliation', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').notNull(),
  platformRevision: bigint('platform_revision', { mode: 'number' }).notNull(),
  sourceRevision: text('source_revision').notNull(),
  sourceEvidence: jsonb('source_evidence').$type<Record<string, unknown>>().notNull(),
  ownershipRevision: text('ownership_revision').notNull(),
  ownershipEvidence: jsonb('ownership_evidence').$type<Record<string, unknown>>().notNull(),
  movementEvidence: jsonb('movement_evidence').$type<readonly Record<string, unknown>[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
export const customerPaymentFixtureMovementSchema = pgTable('customer_payment_fixture_movement', {
  id: text('id').primaryKey(),
  reconciliationId: text('reconciliation_id').notNull(),
  applicationId: text('application_id').notNull(),
  captureId: text('capture_id').notNull(),
  salonId: text('salon_id').notNull(),
  appointmentId: text('appointment_id').notNull(),
  platformId: text('platform_id').notNull(),
  accountScope: text('account_scope').$type<'connected' | 'platform'>().notNull(),
  accountId: text('account_id'),
  source: text('source').$type<'offline_fixture_test'>().notNull(),
  mode: text('mode').$type<'test'>().notNull(),
  allocation: text('allocation').$type<'unallocated'>().notNull().default('unallocated'),
  bookingCredit: text('booking_credit').$type<'none'>().notNull().default('none'),
  kind: text('kind').$type<'customer_refund' | 'application_fee_refund' | 'dispute_withdrawal' | 'dispute_reinstatement'>().notNull(),
  movementId: text('movement_id').notNull(),
  movementKeyHash: text('movement_key_hash').notNull(),
  operationId: text('operation_id').notNull(),
  chargeId: text('charge_id').notNull(),
  paymentIntentId: text('payment_intent_id').notNull(),
  applicationFeeId: text('application_fee_id'),
  disputeId: text('dispute_id'),
  amountCents: integer('amount_cents').notNull(),
  feeCents: integer('fee_cents'),
  netCents: integer('net_cents'),
  currency: text('currency').$type<'cad'>().notNull(),
  objectCreatedAt: timestamp('object_created_at', { withTimezone: true, mode: 'date' }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  fingerprint: text('fingerprint').notNull(),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
});
export type CustomerPaymentFixtureMovement = typeof customerPaymentFixtureMovementSchema.$inferSelect;
export type CustomerPaymentFixtureReconciliation = typeof customerPaymentFixtureReconciliationSchema.$inferSelect;
